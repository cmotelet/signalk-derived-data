/*
 * Copyright 2017 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const debug = require('debug')('derived-data')
const Bacon = require('baconjs');
const util = require('util')
const _ = require('lodash')
const path = require('path')
const fs = require('fs')

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = []

  plugin.start = function(props) {
    debug("starting")


    _.keys(calculations).forEach(key => {
      calculation = calculations[key]
      if ( !props[key] )
        return
      
      unsubscribes.push(
        Bacon.combineWith(
          calculation.calculator,
          calculation.derivedFrom.map(app.streambundle.getSelfStream, app.streambundle)
        )
          .changes()
          .debounceImmediate(20)
          .onValue(values => {
              var delta = {
                "context": "vessels." + app.selfId,
                "updates": [
                  {
                    "source": {
                      "label": "derived-data-plugin"
                    },
                    "timestamp": (new Date()).toISOString(),
                    "values": values
                  }
                ]
              }

            debug("got delta: " + JSON.stringify(delta))
            app.handleMessage(plugin.id, delta)
          })
      );
    });

    debug("started")
  }

  plugin.stop = function() {
    debug("stopping")
    unsubscribes.forEach(f => f());
    unsubscribes = [];
    debug("stopped")
  }

  plugin.id = "derived-data"
  plugin.name = "Derived Data"
  plugin.description = "Plugin that derives data"

  plugin.schema = {
    title: "Derived Data",
    type: "object",
    properties: {
    }
  }

  var calculations = {
    groundWind: {
      title: "Ground Wind Angle and Speed (based on SOG, AWA and AWS)",
      derivedFrom: [ "navigation.courseOverGroundTrue", "navigation.speedOverGround", "environment.wind.speedApparent", "environment.wind.angleApparent" ],
      calculator: calcGroundWindAndSpeed
    },
    trueWind: {
      title: "True Wind Angle and Speed (based on speed through water, AWA and AWS)",
      derivedFrom: [ "navigation.headingTrue", "navigation.speedThroughWater", "environment.wind.speedApparent", "environment.wind.angleApparent" ],
      calculator: calcTrueWindAndSpeed
    }  
  };

  _.keys(calculations).forEach(key => {
    plugin.schema.properties[key] = {
      title: calculations[key].title,
      type: "boolean",
      default: false
    }
  });
 
  debug("schema: " + JSON.stringify(plugin.schema))

  return plugin;
}

function calcGroundWindAndSpeed(cog, sog, aws, awa) {
  var apparentX = Math.cos(awa) * aws;
  var apparentY = Math.sin(awa) * aws;
  var angle = Math.atan2(apparentY, -sog + apparentX);
  var speed = Math.sqrt(Math.pow(apparentY, 2) + Math.pow(-sog + apparentX, 2));

  if ( angle > 1.5 ) {
    angle = angle - 3.0
  }
  
  return [{ path: "environment.wind.angleTrueGround", value: angle},
          { path: "environment.wind.speedOverGround", value: speed}]
}

function calcTrueWindAndSpeed(headTrue, speed, aws, awa) {
  var apparentX = Math.cos(awa) * aws;
  var apparentY = Math.sin(awa) * aws;
  var angle = Math.atan2(apparentY, -speed + apparentX);
  var speed = Math.sqrt(Math.pow(apparentY, 2) + Math.pow(-speed + apparentX, 2));

  angle = headTrue + angle
  
  return [{ path: "environment.wind.directionTrue", value: angle},
          { path: "environment.wind.speedTrue", value: speed}]
}
