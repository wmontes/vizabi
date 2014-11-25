//Indicator Display
define([
    'd3',
    'lodash',
    'base/utils',
    'base/component'
], function(d3, _, utils, Component) {

    var IndicatorDisplay = Component.extend({

        /*
         * INIT:
         * Executed once, before template loading
         */
        init: function(options, context) {
            this.name = "indicator-display";
            this.template = "components/_examples/indicator-display/indicator-display";

            //define expected models for this component
            this.model_expects = ["rows", "time"];

            this._super(options, context);
        },

        /*
         * POSTRENDER:
         * Executed after template is loaded
         * Ideally, it contains instantiations related to template
         */
        postRender: function() {

        },


        /*
         * UPDATE:
         * Executed whenever data is changed
         * Ideally, it contains only operations related to data events
         */
        update: function() {

            var time = parseInt(d3.time.format("%Y")(this.model.time.value), 10),
                rows = this.model.rows.label.getValues(),
                countriesCurr = [];

            countriesCurr = _.filter(rows, function(d) {
                return (d.time == time);
            });


            this.element.selectAll("p").remove();

            this.element.selectAll("p")
                .data(countriesCurr)
                .enter()
                .append("p");

            this.resize();

        },

        /*
         * RESIZE:
         * Executed whenever the container is resized
         * Ideally, it contains only operations related to size
         */
        resize: function() {
            var indicator = this.model.rows.number.value,
                _this = this;

            //todo: hooks can't be hacked like this
            this.element.selectAll("p")
                .text(function(d) {

                    var id = _.pick(d, ["geo", "time"]),
                        label = _this.model.rows.label.getValue(id),
                        number = _this.model.rows.number.getValue(id),
                        string = label + ": ";

                    if (_this.getLayoutProfile() === 'small' && indicator === 'pop') {
                        string += Math.round(number / 100000) / 10 + " M";
                    } else if (indicator === 'pop') {
                        string += Math.round(number).toLocaleString();
                    } else {
                        string += number.toLocaleString();
                    }

                    return string;
                })
                .style("color", function(d) {
                    var id = _.pick(d, ["geo", "time"]);
                    return _this.model.rows.color.getValue(id);
                });
        },


    });

    return IndicatorDisplay;

});