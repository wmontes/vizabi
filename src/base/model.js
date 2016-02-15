import * as utils from 'utils';
import Promise from 'promise';
import Data from 'data';
import EventSource, {DefaultEvent, ChangeEvent} from 'events';
import Intervals from 'intervals';
import * as models from 'models/_index';

var _DATAMANAGER = new Data();

var ModelLeaf = EventSource.extend({

  _name: '',
  _parent: null,
  _persistent: true,

  init: function(name, value, parent, binds) {

    // getter and setter for the value
    Object.defineProperty(this, 'value', {
      get: this.get,
      set: this.set
    });
    Object.defineProperty(this, 'persistent', {
      get: function() { return this._persistent; }
    });

    this._super();

    this._name = name;
    this._parent = parent;
    this.value = value;
    this.on(binds); // after super so there is an .events object
  },

  // if they want a persistent value and the current value is not persistent, return the last persistent value
  get: function(persistent) {
    return (persistent && !this._persistent) ? this._persistentVal : this._val;
  },

  set: function(val, force, persistent) {
    if (force || (this._val !== val && JSON.stringify(this._val) !== JSON.stringify(val))) {

      // persistent defaults to true
      persistent = (typeof persistent !== 'undefined') ? persistent : true;
 
      // set leaf properties
      if (persistent) this._persistentVal = val; // set persistent value if change is persistent.
      this._val = val;
      this._persistent = persistent;

      // trigger change event
      this.trigger(new ChangeEvent(this), this._name);
    }
  },

  // duplicate from Model. Should be in a shared parent class.
  setTreeFreezer: function(freezerStatus) {
    if (freezerStatus) {
      this.freeze();
    } else {
      this.unfreeze();
    }
  }

})

var Model = EventSource.extend({

  /**
   * Initializes the model.
   * @param {Object} values The initial values of this model
   * @param {Object} parent reference to parent
   * @param {Object} bind Initial events to bind
   * @param {Boolean} freeze block events from being dispatched
   */
  init: function(name, values, parent, bind) {
    this._type = this._type || 'model';
    this._id = this._id || utils.uniqueId('m');
    this._data = {};
    //holds attributes of this model
    this._parent = parent;
    this._name = name;
    this._readyPromise = new Promise();
    this._loadPromise = new Promise();
    this._readyOnce = false;
    //array of processes that are loading
    this._intervals = getIntervals(this);
    //holds the list of dependencies for virtual models
    this._deps = {
      parent: [],
      children: []
    };
    //will the model be hooked to data?
    this._space = {};
    this._spaceDims = {};

    this._dataId = false;
    this._limits = {};
    //stores limit values
    this._super();

    //initial values
    if(values) {
      this.set(values);
    }
    // bind initial events
    // bind after setting, so no events are fired by setting initial values
    if(bind) {
      this.on(bind);
    }
  },

  /* ==========================
   * Getters and Setters
   * ==========================
   */

  /**
   * Gets an attribute from this model or all fields.
   * @param attr Optional attribute
   * @returns attr value or all values if attr is undefined
   */
  get: function(attr) {
    if(!attr) {
      return this._data;
    }
    if (isModel(this._data[attr]))
      return this._data[attr];
    else
      return this._data[attr].value; // return leaf value
  },

  /**
   * Sets an attribute or multiple for this model (inspired by Backbone)
   * @param attr property name
   * @param val property value (object or value)
   * @param {Boolean} force force setting of property to value and triggers set event
   * @param {Boolean} persistent true if the change is a persistent change
   * @returns defer defer that will be resolved when set is done
   */
  set: function(attr, val, force, persistent) {
    var attrs;
    var freezeCall = false; // boolean, indicates if this .set()-call froze the modelTree
    
    //expect object as default
    if(!utils.isPlainObject(attr)) {
      (attrs = {})[attr] = val;
    } else {
      // move all arguments one place
      attrs = attr;
      persistent = force;
      force = val;
    }

    // Freeze the whole model tree if not frozen yet, so no events are fired while setting
    if (!this._freeze) {
      freezeCall = true;
      this.setTreeFreezer(true);
    }

    // init/set all given values
    var newSubmodels = false;
    for(var attribute in attrs) {
      val = attrs[attribute];

      var bothModel = utils.isPlainObject(val) && this._data[attribute] instanceof Model;
      var bothModelLeaf = !utils.isPlainObject(val) && this._data[attribute] instanceof ModelLeaf;
      
      if (this._data[attribute] && (bothModel || bothModelLeaf)) {
        // data type does not change (model or leaf and can be set through set-function)
        this._data[attribute].set(val, force, persistent);
      } else {
        // data type has changed or is new, so initializing the model/leaf
        this._data[attribute] = initSubmodel(attribute, val, this);
        bindSetterGetter(this, attribute);
      }
    }

    // if this set()-call was the one freezing the tree, now the tree can be unfrozen (i.e. all setting is done)
    if (freezeCall) {
      this.setTreeFreezer(false);
    }

  },


  setTreeFreezer: function(freezerStatus) {
    // first traverse down
    // this ensures deepest events are triggered first
    utils.forEach(this._data, function(submodel) {
      submodel.setTreeFreezer(freezerStatus);
    });

    // then freeze/unfreeze
    if (freezerStatus) {
      this.freeze();
    } else {
      this.unfreeze();
    }
  },

  /**
   * Gets the type of this model
   * @returns {String} type of the model
   */
  getType: function() {
    return this._type;
  },

  /**
   * Gets all submodels of the current model
   * @param {Object} object [object=false] Should it return an object?
   * @param {Function} fn Validation function
   * @returns {Array} submodels
   */
  getSubmodels: function(object, validationFunction) {
    var submodels = (object) ? {} : [];
    var validationFunction = validationFunction || function() {
      return true;
    };
    var _this = this;
    utils.forEach(this._data, function(subModel, name) {
      if(subModel && typeof subModel._id !== 'undefined' && isModel(subModel) && validationFunction(subModel)) {
        if(object) {
          submodels[name] = subModel;
        } else {
          submodels.push(subModel);
        }
      }
    });
    return submodels;
  },

  /**
   * Gets the current model and submodel values as a JS object
   * @returns {Object} All model as JS object, leafs will return their values
   */
  getPlainObject: function(persistent) {
    var obj = {};
    utils.forEach(this._data, function(dataItem, i) {
      // if it's a submodel
      if(dataItem instanceof Model) {
        obj[i] = dataItem.getPlainObject(persistent);
      } 
      // if it's a modelLeaf
      else {
        obj[i] = dataItem.get(persistent);
      }
    });
    return obj;
  },


  /**
   * Gets the requested object, including the leaf-object, not the value
   * @returns {Object} Model or ModelLeaf object.
   */
  getModelObject: function(name) {
    if (name)
      return this._data[name];
    else
      return this;
  },

  /**
   * Clears this model, submodels, data and events
   */
  clear: function() {
    var submodels = this.getSubmodels();
    for(var i in submodels) {
      submodels[i].clear();
    }
    this._spaceDims = {};
    this._readyPromise = new Promise();
    this.off();
    this._intervals.clearAllIntervals();
    this._data = {};
  },

  /**
   * Validates data.
   * Interface for the validation function implemented by a model
   * @returns Promise or nothing
   */
  validate: function() {},

  /* ==========================
   * Model loading
   * ==========================
   */

  /**
   * loads data (if hook)
   * Hooks loads data, models ask children to load data
   * Basically, this method:
   * loads is theres something to be loaded:
   * does not load if there's nothing to be loaded
   * @param {Object} options (includes splashScreen)
   * @returns defer
   */  
  load: function(opts) {

    var _this = this;
    var promises = [];

    this.resetLoadPromise();

    promises.push(this.loadData(opts));
    promises.push(this.loadSubmodels(opts));
    
    var everythingLoaded = Promise.all(promises);
    everythingLoaded.then( 
      this.onSuccessfullLoad.bind(this),
      this.triggerLoadError.bind(this)
    );

    return this._loadPromise;
  },

  resetLoadPromise: function() {
    var oldLoadPromise = this._loadPromise;
    this._loadPromise = new Promise();
    this._loadPromise.then(function() { oldLoadPromise.resolve(); });
  },

  loadData: function(opts) {
    // will be overloaded in hook models
    return new Promise.resolve();
  },

  loadSubmodels: function(options) {
    var promises = [];
    var subModels = this.getSubmodels();
    utils.forEach(subModels, function(subModel) {
      var subModelLoad = subModel.load(options);
      promises.push(subModelLoad);
    });
    return promises.length > 0 ? Promise.all(promises) : new Promise().resolve();
  },  

  onSuccessfullLoad: function() {

    utils.timeStamp('Vizabi Model: Model loaded: ' + this.name + '(' + this._id + ')');
    this._loadPromise.resolve();
    this._readyPromise.resolve();

  },

  triggerLoadError: function() {
    this.trigger('load_error');
    this._loadPromise.reject();
  },


  /**
   * executes after preloading processing is done
   */
  afterPreload: function() {
    var submodels = this.getSubmodels();
    utils.forEach(submodels, function(s) {
      s.afterPreload();
    });
  },

  /**
   * removes all external dependency references
   */
  resetDeps: function() {
    this._deps.children = [];
  },

  /**
   * add external dependency ref to this model
   */
  addDep: function(child) {
    this._deps.children.push(child);
    child._deps.parent.push(this);
  },


  /* ===============================
   * Hooking model to external data
   * ===============================
   */

  /**
   * is this model hooked to data?
   */
  isHook: function() {
    return this.use ? true : false;
  },

  /**
   * Gets all submodels of the current model that are hooks
   * @param object [object=false] Should it return an object?
   * @returns {Array|Object} hooks array or object
   */
  getSubhooks: function(object) {
    return this.getSubmodels(object, function(s) {
      return s.isHook();
    });
  },

  /**
   * gets all sub values for a certain hook
   * only hooks have the "hook" attribute.
   * @param {String} type specific type to lookup
   * @returns {Array} all unique values with specific hook use
   */
  getHookWhich: function(type) {
    var values = [];
    if(this.use && this.use === type) {
      values.push(this.which);
    }
    //repeat for each submodel
    utils.forEach(this.getSubmodels(), function(s) {
      values = utils.unique(values.concat(s.getHookWhich(type)));
    });
    //now we have an array with all values in a type of hook for hooks.
    return values;
  },

  /**
   * gets all sub values for indicators in this model
   * @returns {Array} all unique values of indicator hooks
   */
  getIndicators: function() {
    return this.getHookWhich('indicator');
  },

  /**
   * gets all sub values for indicators in this model
   * @returns {Array} all unique values of property hooks
   */
  getProperties: function() {
    return this.getHookWhich('property');
  },

  /**
   * Gets the dimension of this model if it has one
   * @returns {String|Boolean} dimension
   */
  getDimension: function() {
    return this.dim || false; //defaults to dim if it exists
  },

  /**
   * Gets the dimension (if entity) or which (if hook) of this model
   * @returns {String|Boolean} dimension
   */
  getDimensionOrWhich: function() {
    return this.dim || (this.use != 'constant' ? this.which : false); //defaults to dim or which if it exists
  },

  /**
   * Gets the filter for this model if it has one
   * @returns {Object} filters
   */
  getFilter: function() {
    return {}; //defaults to no filter
  },


  /**
   * maps the value to this hook's specifications
   * @param value Original value
   * @returns hooked value
   */
  mapValue: function(value) {
    return value;
  },


  /**
   * gets filtered dataset with fewer keys
   * @param {Object} filter
   * @returns {Object} filtered items object
   */
  getFilteredItems: function(filter) {
    if(!filter) return utils.warn("No filter provided to getFilteredItems(<filter>)");
    return _DATAMANAGER.get(this._dataId, 'filtered', filter);
  },
    
  /**
   * gets nested dataset
   * @param {Array} keys define how to nest the set
   * @returns {Object} hash-map of key-value pairs
   */
  getNestedItems: function(keys) {
    if(!keys) return utils.warn("No keys provided to getNestedItems(<keys>)");
    return _DATAMANAGER.get(this._dataId, 'nested', keys);
  },


  /**
   * Gets formatter for this model
   * @returns {Function|Boolean} formatter function
   */
  getParser: function() {
    //TODO: default formatter is moved to utils. need to return it to hook prototype class, but retest #1212 #1230 #1253
    return null;
  },

  getDataManager: function(){
    return _DATAMANAGER;
  },

  /**
   * Gets limits
   * @param {String} attr parameter
   * @returns {Object} limits (min and max)
   */
  getLimits: function(attr) {
    return _DATAMANAGER.get(this._dataId, 'limits', attr);
  },

  /**
   * gets first dimension that matches type
   * @param {Object} options
   * @returns {Array} all unique dimensions
   */
  _getFirstDimension: function(opts) {
    opts = opts || {};

    var models = this._space;
    //in case it's a parent of hooks
    if(!this.isHook() && this.space) {
      models = [];
      var _this = this;
      utils.forEach(this.space, function(name) {
        models.push(getClosestModel(_this, name));
      });
    }

    var dim = false;
    utils.forEach(models, function(m) {
      if(opts.exceptType && m.getType() !== opts.exceptType) {
        dim = m.getDimension();
        return false;
      } else if(opts.type && m.getType() === opts.type) {
        dim = m.getDimension();
        return false;
      } else if(!opts.exceptType && !opts.type) {
        dim = m.getDimension();
        return false;
      }
    });
    return dim;
  },


  /**
   * gets grouping for each of the used entities
   * @param {Boolean} splashScreen get filters for first screen only
   * @returns {Object} filters
   */
  _getGrouping: function() {
    var group_by = {};
    utils.forEach(this._space, function(h) {
      group_by[h.dim] = h.grouping || undefined;
    });
    return group_by;
  },

  getDefaults: function() {
    // if defaults are set, does not care about defaults from children
    if(this._defaults) return this._defaults;
    var d = {};
    utils.forEach(this.getSubmodels(true), function(model, name) {
      d[name] = model.getDefaults();
    });
    return d;
  }

});

/* ===============================
 * Private Helper Functions
 * ===============================
 */

/**
 * Checks whether an object is a model or not
 * if includeLeaf is true, a leaf is also seen as a model
 */
function isModel(model, includeLeaf) {
  return model && (model.hasOwnProperty('_data') || (includeLeaf &&  model.hasOwnProperty('_val')));
}

/**
 * Binds all attributes in _data to magic setters and getters
 */
function bindSettersGetters(model) {
  for(var prop in model._data) {
    bindSetterGetter(model, prop);
  }
}

function bindSetterGetter(model, prop) {
  Object.defineProperty(model, prop, {
    configurable: true,
    //allow reconfiguration
    get: function(p) {
      return function() {
        return model.get(p);
      };
    }(prop),
    set: function(p) {
      return function(value) {
        return model.set(p, value);
      };
    }(prop)
  });  
}

/**
 * Loads a submodel, when necessaary
 * @param {String} attr Name of submodel
 * @param {Object} val Initial values
 * @param {Object} ctx context / parent model
 * @returns {Object} model new submodel
 */
function initSubmodel(attr, val, ctx) {

  var submodel;

  // if value is a value -> leaf
  if(!utils.isPlainObject(val) || utils.isArray(val)) {  

    var binds = {
      //the submodel has changed (multiple times)
      'change': onChange
    }
    submodel = new ModelLeaf(attr, val, ctx, binds);
  }

  // if value is an object -> model
  else {

    var binds = {
      //the submodel has changed (multiple times)
      'change': onChange,
      //loading has failed in this submodel (multiple times)
      'load_error': onLoadError,
    };

    // if the value is an already instantiated submodel (Model or ModelLeaf)
    // this is the case for example when a new componentmodel is made (in Component._modelMapping)
    // it takes the submodels from the toolmodel and creates a new model for the component which refers 
    // to the instantiated submodels (by passing them as model values, and thus they reach here)
    if (isModel(val, true)) {
      submodel = val;
      submodel.on(binds);
    } 
    // if it's just a plain object, create a new model
    else {
      // construct model
      var modelType = attr.split('_')[0];
      var Modl = Model.get(modelType, true) || models[modelType] || Model;
      submodel = new Modl(attr, val, ctx, binds);

      // model is still frozen but will be unfrozen at end of original .set()
    }
  }

  return submodel;

  // Default event handlers for models
  function onChange(evt, path) {
    path = ctx._name + '.' + path
    ctx.trigger(evt, path);    
  }
  function onLoadStart(evt, vals) {
    ctx.trigger(evt, vals);
  }
  function onLoadError(evt, vals) {
    ctx.trigger(evt, vals);
  }
}

/**
 * gets closest interval from this model or parent
 * @returns {Object} Intervals object
 */
function getIntervals(ctx) {
  if(ctx._intervals) {
    return ctx._intervals;
  } else if(ctx._parent) {
    return getIntervals(ctx._parent);
  } else {
    return new Intervals();
  }
}


export default Model;