import ui from '../lib/ui';
import Command from '../lib/command';
import forIn from 'lodash/forIn';
import padEnd from 'lodash/padEnd';

export default class RootCommand extends Command {

  static hidden = true;

  flags = {
    version: {
      description: `
        Print the version of Denali used in the current project, or the global
        version if invoked outside a project
      `,
      type: Boolean
    },
    help: {
      description: 'Show this help message',
      type: Boolean
    }
  };

  run({ params, flags }, argTokens, commands) {
    if (flags.version) {
      this.printVersion();
    } else {
      this.printHelp(commands);
    }
  }

  printVersion() {
    let pkg = require('./package.json');
    ui.info(`denali: ${ pkg.dependencies.denali }`);
    ui.info(`node: ${ process.version }`);
  }

  printHelp(commands) {
    ui.info(`
usage: denali [command] [args]

Available commands:
`.trim());

    let pad = Object.keys(commands).reduce((longest, name) => Math.max(longest, name.length), 0);

    forIn(commands, (CommandClass, name) => {
      if (CommandClass.hidden !== true) {
        ui.info(`  ${ padEnd(name, pad) }   ${ CommandClass.description }`);
      }
    });
  }

}

