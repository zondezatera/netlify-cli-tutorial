import Rusha from 'rusha';
import Auth from '../lib/netlify-auth';
import API from '../lib/netlify-api';
import { lookup } from '../lib/filesystem';
import { addHistory } from './base';
import { showHelp } from './help';
import { setPrompt, clearPrompt, hidePrompt } from './prompt';

let credentials = null;

export function netlify(names) {
  return (dispatch, getState) => {
    const { help, npm, prompt } = getState();

    if (prompt.handler && prompt.data.setting == 'site') {
      return configureSite(dispatch, getState(), names[0]);
    }
    if (prompt.handler && prompt.data.setting === 'dir') {
      return configureDir(dispatch, getState(), names[0]);
    }

    if (!npm.packages['netlify-cli']) {
      return commandNotFound(dispatch);
    }

    if (names.length === 0 || names[1] === 'help') {
      outputHelp(dispatch);
      if (!help.netlify) {
        dispatch(showHelp());
      }
      return;
    }

    switch (names[0]) {
      case 'deploy':
        return deploy(dispatch, getState());
      case 'open':
        return openSite(dispatch, getState());
      default:
        return outputHelp(dispatch);
    }
  };
}

function commandNotFound(dispatch) {
  dispatch(addHistory(
    '-bash: netlify: command not found',
    '',
    '(hint: make sure to run \'npm install netlify-cli -g\' first)'
  ));
}

function outputHelp(dispatch) {
  dispatch(addHistory(
'',
'  Usage: netlify [options] [command]',
'',
'    The premium hosting service for modern static websites',
'',
'    Read more at https://www.netlify.com/docs/cli',
'',
'  Commands:',
'',
'    create [options]   Create a new site',
'    deploy [options]   Push a new deploy to netlify',
'    update [options]   Updates site attributes',
'    delete [options]   Delete site',
'    sites [options]    List your sites',
'    open [options]     Open site in the webui',
'    init               Configure continuous deployment',
'',
'  Options:',
'',
'    -h, --help                 output usage information',
'    -V, --version              output the version number',
'    -t --access-token <token>  Override the default Access Token',
'    -e --env <environment>     Specify an environment',
''));
}

function openSite(dispatch, state) {
  window.open('https://example.netlify.com');
}

function configureSite(dispatch, state, answer) {
  dispatch(setPrompt('netlify', '? Path to deploy? (current dir) ', {setting: 'dir'}));
}

function configureDir(dispatch, state, folder) {
  const { cwd } = state;
  dispatch(clearPrompt());
  dispatch(addHistory('Deploying folder ' + (folder || cwd)));
  return withAuth(deploySite, dispatch, state, folder);
  // const showDeploy = (uploaded) => {
  //   var progress = '[';
  //   for (var i = 0; i < 40; i++) {
  //     if (i <= 40 * uploaded / 5) {
  //       progress += '=';
  //     } else {
  //       progress += ' ';
  //     }
  //   }
  //   progress += '] Uploading';
  //   dispatch(updateHistory(progress));
  //   if (uploaded == 5) {
  //     dispatch(addHistory(
  //       'Awesome! You just deployed your first site to netlify',
  //       '',
  //       'Check it out at http://example.netlify.com/',
  //       ''
  //     ));
  //     dispatch(clearPrompt());
  //   } else {
  //     var time = Math.random() * 800 + 200;
  //     setTimeout((() => showDeploy(uploaded + 1)), time);
  //   }
  // };
  // dispatch(hidePrompt());
  // dispatch(addHistory(
  //   '[                                        ] Uploading'
  // ));
  // showDeploy(0);
}

function withAuth(fn, dispatch, state, arg) {
  if (credentials) {
    return fn(dispatch, state, arg);
  }
  const auth = new Auth({site_id: 'app.netlify.com'});
  auth.authenticate({provider: 'github', scope: 'user', login: true}, (err, data) => {
    if (err) {
      return dispatch(addHistory(
        'Authentication failed :('
      ));
    }
    credentials = data;
    fn(dispatch, state, arg);
  });
}

function deploy(dispatch, state) {
  const { cwd } = state;
  switch (cwd) {
    case 'static-site':
    case 'jekyll-site':
      return dispatch(setPrompt('netlify', '? No site id specified, create a new site (Y/n) ', {setting: 'site'}));
    default:
      dispatch(addHistory(
        'The real netlify CLI will let you push just about anything to our CDN',
        'However, for this demo - try one of the example sites.'
      ));
  }
}

function walkFiles(state, folder, fn)  {
  const dir = lookup(state.files, state.cwd, folder);
  Object.keys(dir).forEach((name) => {
    const fullName = folder ? `${folder}/${name}` : name;
    if (name.match(/^\./)) { return; }
    if (typeof dir[name] === 'object') {
      walkFiles(state, fullName, fn);
    } else {
      fn(fullName, dir[name]);
    }
  });
}

function deploySite(dispatch, state, folder) {
  const sha1 = new Rusha();
  const digests = {};
  const toUpload = {};
  walkFiles(state, folder, (path, content) => {
    digests[path] = sha1.digest(content);
    toUpload[path] = content;
  });
  const api = new API({accessToken: credentials.user.access_token});
  dispatch(hidePrompt());
  dispatch(addHistory('Creating new site'));
  api.createSite({
    files: digests
  }).then((response) => {
    console.log(response);
    dispatch(addHistory('Uploading files'));
    const uploads = [];
    Object.keys(toUpload).forEach((path) => {
      if (response.data.required.indexOf(digests[path]) > -1) {
        uploads.push(api.uploadFile(response.data.deploy_id, `/${path}`, toUpload[path]));
      }
    });
    Promise.all(uploads).then((done) => {
      api.site(response.data.subdomain).then((site) => {
        dispatch(addHistory(
          'Your site has beeen deployed to:',
          '',
          `  [[${site.data.url}]]`,
          ''
        ));
        dispatch(clearPrompt());
      });
    });
  });
}
