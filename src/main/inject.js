// Basic underlying functions

/**
 * Attach a list of dependencies to the target constructor or prototype.
 *
 * If the `name` parameter is truthy, we're dealing with a method rather
 * than a class. If this is on a method, then `target` is the prototype.
 * If this is on a class, then `target` is the constructor.
 */
function attachDependencies(target, name, dependencies) {
  if (name) {
    target[name].dependencies = dependencies;
  } else {
    target.dependencies = dependencies;
  }
}

/**
 * Create a wrapper class to allow transparent injection.
 *
 * @TODO: add an option to allow passthrough (create an instance of the
 *        original class with the right params)
 */
function wrapClass(target, {hook, pass = false}) {
  return class wrapper extends target {
    static get wrappedClass() {
      return target;
    }

    constructor(...args) {
      const [{injector}] = args;
      hook(target, args);
      // this is actually a super call with modified params
      super(injector.getDependencies(wrapper.dependencies).concat(args));
    }
  }
}

/**
 * Define constructor dependencies for the current class.
 *
 * This decorator takes each dependency (by interface) as a parameter
 * and will provide an instance of each to the decorated class' constructor,
 * when instantiated through an Injector.
 */
export function Inject(...dependencies) {
  return function decorator(target, name) {
    attachDependencies(target, name, dependencies);
  }
}

/**
 * Define constructor dependencies and replace the constructor
 * with an auto-wrapping one, to support libraries like React.
 */
export function WrapInject(options, ...dependencies) {
  return function decorator(target, name) {
    if (name) {
      throw new Error('unable to wrap a method');
    } else {
      const wrapper = wrapClass(target);
      attachDependencies(wrapper, name, dependencies);
      return wrapper;
    }
  }
}

/**
 * Mark a module method as the factory for an interface.
 *
 * This decorator takes the interface as a parameter and
 * will register the method on the module class as being
 * the appropriate factory for the interface.
 *
 * Provider methods will be called if no binding is found.
 */
export function Provides(iface) {
  return function decorator(proto, name) {
    const target = proto.constructor;
    if (!target.providers) {
      target.providers = new Map();
    }
    target.providers.set(iface, proto[name]);
  }
}

export class Module {
  constructor() {
    this._bindings = new Map();
  }

  get bindings() {
    return this._bindings;
  }

  bind(iface) {
    return {
      to: (impl) => {
        this._bindings.set(iface, impl);
      }
    };
  }

  configure() {
    throw new Error('Configure has not been implemented for module!');
  }

  getClass() {
    return this.constructor;
  }

  getBinding(iface) {
    return this._bindings.get(iface);
  }

  getProvider(iface) {
    const clazz = this.getClass();
    if (clazz.providers && clazz.providers.has(iface)) {
      return clazz.providers.get(iface);
    } else {
      return null;
    }
  }

  has(iface) {
    const clazz = this.getClass();
    return this._bindings.has(iface) || (clazz.providers && clazz.providers.has(iface));
  }
}

export class Injector {
  static isConstructor(fn) {
    return fn.prototype && fn === fn.prototype.constructor;
  }

  static isFunction(fn) {
    return typeof fn === 'function';
  }

  constructor(...modules) {
    this._modules = modules.map(module => (module.configure(), module));
  }

  get modules() {
    return this._modules;
  }

  getDependencies(dependencies) {
    return dependencies.map(dep => {
      // Find the first module providing a dep
      const module = this._modules.find(m => m.has(dep));
      if (!module) {
        throw new Error('Unable to find any implementation for interface.', dep);
      }

      // Thanks to the has check in find, one of provider
      // or binding is guaranteed to be present.
      const provider = module.getProvider(dep);
      if (provider) {
        return this.execute(provider, module);
      }

      const binding = module.getBinding(dep);
      if (Injector.isFunction(binding)) {
        return this.execute(binding, null);
      }

      return binding;
    });
  }

  execute(fn, scope, params = []) {
    const args = this.getDependencies(fn.dependencies || []).concat(params);

    if (Injector.isConstructor(fn)) {
      return new fn(...args);
    } else {
      return fn.apply(scope, ...args);
    }
  }

  create(ctor, ...params) {
    return this.execute(ctor, null, params);
  }
}
