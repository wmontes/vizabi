define([
    'jquery',
    'd3',
    'underscore',
    'base/utils',
    'base/class'
], function($, d3, _, utils, Class) {

    var Component = Class.extend({
        init: function(parent, options) {
            this.name = this.name || options.name;
            this.state = this.state || options.state;
            this.placeholder = this.placeholder || options.placeholder;
            this.data = this.data || options.data;

            this.model = this.model || options.model;
            this.element = this.element || null;
            this.template = this.template || "components/component";
            this.template_data = this.template_data || {
                name: this.name
            };
            // Markup to define where a Component is going to be rendered.
            // Element which embodies the Component
            this.element = this.element || null;
            this.components = this.components || {};

            this.profiles = this.profiles || {};
            this.parent = parent;

            this.events = this.getInstance('events');
        },

        //TODO: change the scary name! :D bootstrap is one good one
        render: function(callback) {
            var defer = $.Deferred();
            var _this = this;

            // First, we load the template
            var promise = this.loadTemplate();

            // After the template is loaded, check if postRender exists
            promise.then(function() {

                // add css loading class to hide elements
                _this.element.classed("loading", true);

                // attempt to execute postRender
                if (typeof callback === 'function') {
                    return callback();
                }

            })
            // If there is no callback
            .then(function() {
                return _this.execute(_this.postRender);
            })
            // After postRender, resize and load components
            .then(function() {

                //TODO: Chance of refactoring
                //Every widget binds its resize function to the resize event
                _this.resize();
                _this.events.bind('resize', function() {
                    _this.resize();
                });

                return _this.loadComponents();
            })
            // After loading components, render them
            .then(function() {
                return _this.renderComponents();
            })
            // After rendering the components, resolve the defer
            .done(function() {
                //not loading anytmore, remove class
                _this.element.classed("loading", false);

                defer.resolve();
            });

            return defer;
        },

        // Execute function if it exists, with promise support
        execute: function(func) {
            var defer = $.Deferred(),
                possiblePromise;

            // only try to execute if it is a function
            if (_.isFunction(func)) {
                possiblePromise = func.apply(this);
            };

            // if a promise is returned, solve it when its done
            if (possiblePromise && _.isFunction(possiblePromise.then)) {
                possiblePromise.done(function() {
                    defer.resolve();
                });
            }
            // if no promise is returned, resolve right away
            else {
                defer.resolve();
            }

            return defer;
        },

        loadComponents: function() {
            var defer = $.Deferred();
            var promises = [];
            var _this = this;

            // Loops through components, loading them.
            _.each(this.components, function(placeholder, component) {
                var promise = _this.loadComponent(component, placeholder);
                promises.push(promise);
            });

            // When all components have been successfully loaded, resolve the defer
            $.when.apply(null, promises).done(function() {

                //todo: remove comments of simulation
                //setTimeout(function() {
                defer.resolve();
                //}, 1000);
            });

            return defer;
        },

        loadComponent: function(component, placeholder) {
            var _this = this;
            var defer = $.Deferred();
            var path = "components/" + component + "/" + component;

            // Loads the file we need
            require([path], function(subcomponent) {
                _this.components[component] = new subcomponent(_this, {
                    name: component,
                    placeholder: placeholder,
                    model: _this.model
                });

                // Resolve the defer after file has been loaded
                defer.resolve();
            });

            return defer;
        },

        renderComponents: function() {
            var defer = $.Deferred();
            var defers = [];

            // Loops through components, rendering them.
            _.each(this.components, function(component) {
                defers.push(component.render());
            });

            // After all components are rendered, resolve the defer
            $.when.apply(null, defers).done(function() {
                defer.resolve();
            });

            return defer;
        },

        loadTemplate: function() {
            var _this = this;
            var defer = $.Deferred();

            //require the template file
            require(["text!" + this.template + ".html"], function(html) {
                //render template using underscore
                var rendered = _.template(html, _this.template_data);

                //place the contents into the correct placeholder
                _this.placeholder = d3.select(_this.placeholder);
                _this.placeholder.html(rendered);

                //TODO: refactor the way we select the first child
                //define this element inside the placeholder
                _this.element = utils.jQueryToD3(
                    utils.d3ToJquery(_this.placeholder).children().first()
                );

                //Resolve defer
                defer.resolve();
            });

            return defer;
        },

        //TODO: remove this method - It's just wrapping an already
        //existing model method
        setState: function(state) {
            this.model.setState(state);
        },

        // Component-level update updates the sub-components
        update: function() {
            for (var i in this.components) {
                if (this.components.hasOwnProperty(i)) {
                  this.components[i].update();
                }
            }
        },

        resize: function() {
            //what to do when page is resized
        },

        postRender: function() {

        },

        getInstance: function(manager) {
            return this.parent.getInstance(manager);
        },

        getLayoutProfile: function() {
            if (this.layout) {
                return this.layout.currentProfile();
            } else {
                return this.parent.getLayoutProfile();
            }
        }

    });


    return Component;
});