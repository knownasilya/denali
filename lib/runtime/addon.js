/**
 * @module denali
 * @submodule runtime
 */
import path from 'path';
import fs from 'fs';
import glob from 'glob';
import findup from 'findup-sync';
import resolve from 'resolve';
import topsort from '../utils/topsort';
import eachDir from '../utils/each-dir';
import isDir from '../utils/is-dir';
import requireDir from '../utils/require-dir';
import tryRequire from '../utils/try-require';
import withoutExt from '../utils/without-ext';
import forIn from 'lodash/forIn';
import forEach from 'lodash/forEach';
import omit from 'lodash/omit';
import { singularize } from 'inflection';


/**
 * Addons are the fundamental unit of organization for Denali apps. The
 * Application class is just a specialized Addon, and each Addon can contain
 * any amount of functionality.
 *
 * ## Structure
 *
 * Addons are packaged as npm modules for easy sharing. When Denali boots up,
 * it searches your node_modules for available Denali Addons (identified by
 * the `denali-addon` keyword in the package.json). Addons can be nested (i.e.
 * an addon can itself depend on another addon).
 *
 * Each addon can be composed of one or several of the following parts:
 *
 *   * Config
 *   * Initializers
 *   * Middleware
 *   * App classes
 *   * Routes
 *
 * ## Load order
 *
 * After Denali discovers the available addons, it then merges them to form a
 * unified application. Addons higher in the dependency tree take precedence,
 * and sibling addons can specify load order via their package.json files:
 *
 *     "denali": {
 *       "before": [ "another-addon-name" ],
 *       "after": [ "cool-addon-name" ]
 *     }
 *
 * @class Addon
 * @constructor
 * @extends Object
 * @param options {Object}
 * @param options.environment {String}
 * @param options.dir {String} the directory that contains the source for this
 * addon
 * @param options.container {Container}
 * @param options.logger {Logger}
 * @param options.addons {Array} an array of directory paths that contain addons
 * or Addon instances
 * @private
 */
export default class Addon {

  /**
   * The current environment for the app, i.e. 'development'
   *
   * @property environment
   * @type {String}
   */
  environment;

  /**
   * The root directory on the filesystem for this addon
   *
   * @property dir
   * @type {String}
   */
  dir;

  /**
   * The list of child addons that this addon contains
   *
   * @property addons
   * @type {Array}
   */
  addons;

  /**
   * The configuration that is specific to this addon
   *
   * @property _config
   * @type {Object}
   */
  _config;

  /**
   * Which file extensions should be autoloaded into the container.
   *
   * @property autoLoadExtensions
   * @type {Array}
   * @default [ 'js', 'json', 'txt', 'html' ]
   */
  autoLoadExtensions = [ 'js', 'json', 'txt', 'html' ];

  constructor(options = {}) {
    this.environment = options.environment;
    this.dir = options.dir;
    this.container = options.container;
    this.logger = options.logger;

    this.pkg = options.pkg || tryRequire(findup('package.json', { cwd: this.dir }));
    this.addons = this.discoverAddons(options.addons || []);
    this._config = this.loadConfig();
  }

  get mainDir () { return path.join(this.dir, 'app'); }
  get configDir () { return path.join(this.dir, 'config'); }
  get name () { return (this.pkg && this.pkg.name) || 'anonymous-addon'; }

  /**
   * Search this addon's package.json dependencies for Denali addons. For each
   * discovered addon, instantiate it's Addon class, and add it to the addon
   * graph. Return the sorted addon graph.
   *
   * Note that this only returns top-level addons - nested addons are built
   * when the top-level addon is instantiated here.
   *
   * @method discoverAddons
   * @param preseededAddons {Array} an array of Addon instances, or directories
   * that contain the addons to be instantiated; useful to programmatically add
   * to the list of addons that are discovered, i.e. during testing
   * @return {Addon[]} list of addons sorted by load order
   * @private
   */
  discoverAddons(preseededAddons) {
    let addons = [];

    // Instantiate (if neccessary) and load preseed addons
    preseededAddons.forEach((addon) => {
      if (typeof addon === 'string') {
        addon = this.createAddonFromDirectory(addon);
      }
      addons.push(addon);
    });

    // Discover dependencies
    forIn(this.pkg.dependencies, (version, pkgName) => {
      let pkgMainPath = resolve.sync(pkgName, { basedir: this.dir });
      let pkgJSONPath = path.resolve(findup('package.json', { cwd: pkgMainPath }));
      // TODO this shouldn't need to be aware of dist
      let pkgDir = path.join(path.dirname(pkgJSONPath), 'dist');
      let pkg = require(pkgJSONPath);
      let isDenaliAddon = pkg.keywords && pkg.keywords.includes('denali-addon');

      if (isDenaliAddon) {
        addons.push(this.createAddonFromDirectory(pkgDir));
      }
    });

    // Transform into topsort-able format
    addons = addons.map((addon) => {
      let loadOptions = addon.pkg.denali || {};
      return {
        name: addon.pkg.name,
        value: addon,
        before: loadOptions.before,
        after: loadOptions.after
      };
    });

    return topsort(addons, { valueKey: 'value' });
  }

  /**
   * Given a directory that contains an addon, load that addon and instantiate
   * it's Addon class.
   *
   * @method createAddonFromDirectory
   * @param directory {String} path to the directory containing the addon
   * @return {Addon} the instantiated Addon class representing that directory
   * @private
   */
  createAddonFromDirectory(directory) {
    let pkg;
    let AddonClass;
    try {
      pkg = require(path.join(directory, 'package.json'));
      AddonClass = require(path.join(directory, 'app', 'addon.js'));
    } catch (e) {
      this.logger.error(`Error loading an addon from ${ directory }:`);
      this.logger.error(e);
      throw e;
    }
    AddonClass = AddonClass.default || AddonClass || Addon;
    return new AddonClass({
      dir: directory,
      environment: this.environment,
      parent: this,
      container: this.container,
      pkg
    });
  }

  /**
   * Load the config for this addon. The standard `config/environment.js` file
   * is loaded by default. `config/middleware.js` and `config/routes.js` are
   * ignored. All other userland config files are loaded into the container
   * under their filenames.
   *
   * Config files are all .js files, so just the exported functions are loaded
   * here. The functions are run later, during application initialization, to
   * generate the actual runtime configuration.
   *
   * @method loadConfig
   * @return {Object} the config/environment.js output
   * @private
   */
  loadConfig() {
    let config = this.loadConfigFile('environment') || function() { return {}; };
    let allConfigFiles = requireDir(this.configDir, { recurse: false });
    let extraConfigFiles = omit(allConfigFiles, 'environment', 'middleware', 'routes');
    forEach(extraConfigFiles, (configModule, configFilename) => {
      let configModulename = withoutExt(configFilename);
      this.container.register(`config:${ configModulename }`, configModule);
    });
    return config;
  }

  /**
   * Load the addon's various assets. Loads child addons first, meaning that
   * addon loading is depth-first recursive.
   *
   * @method load
   * @private
   */
  load() {
    this.addons.forEach((addon) => {
      addon.load();
    });
    this.loadInitializers();
    this.loadMiddleware();
    this.loadApp();
    this.loadRoutes();
  }

  /**
   * Load the initializers for this addon. Initializers live in
   * `config/initializers`.
   *
   * @method loadInitializers
   * @private
   */
  loadInitializers() {
    let initializersDir = path.join(this.configDir, 'initializers');
    if (isDir(initializersDir)) {
      let initializers = requireDir(initializersDir);
      forEach(initializers, (initializer, name) => {
        this.container.register(`initializer:${ name }`, initializer);
      });
    }
  }

  /**
   * Load the middleware for this addon. Middleware is specified in
   * `config/middleware.js`. The file should export a function that accepts the
   * router as it's single argument. You can then attach any middleware you'd
   * like to that router, and it will execute before any route handling by
   * Denali.
   *
   * Typically this is useful to register global middleware, i.e. a CORS
   * handler, cookie parser, etc.
   *
   * If you want to run some logic before certain routes only, try using filters
   * on your actions instead.
   *
   * @method loadMiddleware
   * @private
   */
  loadMiddleware() {
    this._middleware = this.loadConfigFile('middleware') || function() {};
  }

  /**
   * Loads the routes for this addon. Routes are defined in `config/routes.js`.
   * The file should export a function that defines routes. See the Routing
   * guide for details on how to define routes.
   *
   * @method loadRoutes
   * @private
   */
  loadRoutes() {
    this._routes = this.loadConfigFile('routes') || function() {};
  }

  /**
   * Load the app assets for this addon. These are the various classes that live
   * under `app/`, including actions, models, etc., as well as any custom class
   * types.
   *
   * Files are loaded into the container under their folder's namespace, so
   * `app/roles/admin.js` would be registered as 'role:admin' in the container.
   * Deeply nested folders become part of the module name, i.e.
   * `app/roles/employees/manager.js` becomes 'role:employees/manager'.
   *
   * Non-JS files are loaded as well, and their container names include the
   * extension, so `app/mailer/welcome.html` becomes `mail:welcome.html`.
   *
   * @method loadApp
   * @private
   */
  loadApp() {
    eachDir(this.mainDir, (dirname) => {
      let dir = path.join(this.mainDir, dirname);
      let type = singularize(dirname);
      glob.sync('**/*', { cwd: dir }).forEach((filepath) => {
        let modulepath = withoutExt(filepath);
        if (filepath.endsWith('.js') || filepath.endsWith('.json')) {
          let mod = require(path.join(dir, filepath));
          this.container.register(`${ type }:${ modulepath }`, mod.default || mod);
        } else if (this.autoLoadExtensions.includes(path.extname(filepath))) {
          this.container.register(`${ type }:${ filepath }`, fs.readFileSync(filepath, 'utf-8'));
        }
      });
    });
  }

  loadConfigFile(filename) {
    let configModule = tryRequire(path.join(this.configDir, `${ filename }.js`));
    return configModule && (configModule.default || configModule);
  }

}
