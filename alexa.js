/**
 * Copyright 2016 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {
    "use strict";
    var request = require('request');
    var mqtt = require('mqtt');
    var bodyParser = require('body-parser');
    var devices = {};

    // Config Node
    function alexaConf(n) {
    	RED.nodes.createNode(this,n);
        this.username = n.username;
    	this.password = this.credentials.password;
        this.mqttserver = n.mqttserver;
        this.webapiurl = n.webapiurl;
        this.users = {};
    	var node = this;

        // MQTT connect options
         var options = {
            username: node.username,
            password: node.password,
            clientId: node.username,
            reconnectPeriod: 5000,
            servers:[
                {
                    protocol: 'mqtts',
                    host: node.mqttserver,
                    port: 8883
                },
                {
                    protocol: 'mqtt',
                    host: node.mqttserver,
                    port: 1883
                }
            ]
        };

        // mqttserver: node.mqttserver,
        // webapiurl: node.webapiurl,
        // ## modified to include webapiurl
        getDevices(node.webapiurl, node.username, node.password, node.id);

        this.connect = function() {
            node.client = mqtt.connect(options);
            node.client.setMaxListeners(0);

            node.client.on('connect', function() {
                node.setStatus({text:'connected', shape:'dot', fill:'green'});

                node.client.removeAllListeners('message');
                node.client.subscribe("command/" + node.username + "/#");
                node.client.on('message', function(topic, message){
                    var msg = JSON.parse(message.toString());
                    
                    // Added Alexa message handler
                    if (msg.hasOwnProperty('directive')) {
                        //console.log("info", "Received Alexa MQTT message");
                        var endpointId = (msg.directive.endpoint.endpointId);
                    }
                    // Google Home message handler
                    if (msg.hasOwnProperty('execution')) {
                        //console.log("info", "Received Google Home MQTT message");
                        var endpointId = (msg.id);
                    }
                    
                    for (var id in node.users) {
                        if (node.users.hasOwnProperty(id)){
                            if (node.users[id].device === endpointId && node.users[id].type == "alexa-smart-home-v3") {
                                //console.log("info", "Sending command message");
                                node.users[id].command(msg);
                            }
                        }
                    }
                });
            });

            node.client.on('offline',function(){
                node.setStatus({text: 'disconnected', shape: 'dot', fill:'red'});
            });

            node.client.on('reconnect', function(){
                node.setStatus({text: 'reconnecting', shape: 'ring', fill:'red'});
            });

            node.client.on('error', function (err){
                //console.log(err);
                node.setStatus({text: 'disconnected', shape: 'dot', fill:'red'});
                node.error(err);
            });
        }

        this.setStatus = function(status) {
            for( var id in node.users) {
                if (node.users.hasOwnProperty(id)) {
                    node.users[id].status(status);
                }
            }
        }

        this.register = function(deviceNode) {
            node.users[deviceNode.id] = deviceNode;
            // Connect only on first node register/ connect
            if (Object.keys(node.users).length === 1) {
                if (deviceNode.type == "alexa-smart-home-v3") {
                    node.connect();
                }
            }
        };

        this.deregister = function(deviceNode, done) {
            delete node.users[deviceNode.id];

            if (Object.keys(node.users).length === 0) {
                //disconnect
                if (node.client && node.client.connected) {
                    node.client.end(done);
                } else {
                    node.client.end();
                    done();
                }
            }

            done();
        };

        this.acknowledge = function(messageId, device, success) {
            var response = {
                messageId: messageId,
                success: success
            };

            //console.log("info, Response: " + JSON.stringify(response));

            var topic = 'response/' + node.username + '/' + device;
            if (node.client && node.client.connected) {
                node.client.publish(topic, JSON.stringify(response));
            }
        };

        // ########################################################## 
        // Config Node Update State
        this.updateState = function(messageId, endpointId, payload, deviceName) {

        var response = {
            messageId: messageId,
            payload: {
                state: {
                    "brightness": payload.state.brightness,
                    "colorBrightness": payload.state.colorBrightness,
                    "colorHue": payload.state.colorHue,
                    "colorSaturation": payload.state.colorSaturation,
                    "colorTemperature": payload.state.colorTemperature,
                    "input": payload.state.input,
                    "lock": payload.state.lock,
                    "percentage": payload.state.percentage,
                    "percentageDelta": payload.state.percentageDelta,
                    "playback": payload.state.playback,
                    "power": payload.state.power,
                    "temperature": payload.state.temperature,
                    "thermostatMode": payload.state.thermostatMode,
                    "thermostatSetPoint" : payload.state.thermostatSetPoint,
                    "targetSetpointDelta": payload.state.targetSetpointDelta,
                    "volume": payload.state.volume,
                    "volumeDelta": payload.state.volumeDelta,
                    }
                }
            };

            node.log("Sending state update: " + JSON.stringify(response));
            var topic = 'state/' + node.username + '/' + endpointId;
            if (node.client && node.client.connected) {
                node.client.publish(topic, JSON.stringify(response));
            }
        };
        // ##########################################################

    	this.on('close',function(){
            if (node.client && node.client.connected) {
                node.client.end();
            }
            //node.removeAllListeners();
    		//delete devices[node.id];
    	});
    };

    // Re-branded for v3 API
    RED.nodes.registerType("alexa-smart-home-v3-conf",alexaConf,{
        credentials: {
            password: {type:"password"}
        }
    });

    // Command Node
    function alexaHome(n) {
    	RED.nodes.createNode(this,n);
    	this.conf = RED.nodes.getNode(n.conf);
        this.confId = n.conf;
    	this.device = n.device;
        this.topic = n.topic;
        this.acknowledge = n.acknowledge;
        this.name = n.name;
        this.type = n.type;

    	var node = this;
        
        // Command Node Command Function
        node.command = function (message){
            //console.log("message", message)

            var messageFormat;

            // Alexa-format message handler
            if (message.hasOwnProperty('directive')) {
                //console.log("Alexa message", message)
                messageFormat = "Alexa";
                var msg ={
                    topic: node.topic || "",
                    name: node.name,
                    _messageId: message.directive.header.messageId,
                    _endpointId: message.directive.endpoint.endpointId,
                    _confId: node.confId,
                    command: message.directive.header.name,
                    extraInfo: message.directive.endpoint.cookie
                }
            }

            // Google-Home format message handler
            else if (message.hasOwnProperty('execution')) {
                //console.log("Google Home message", message)
                messageFormat = "Google Home";
                var msg = {
                    topic: node.topic || "",
                    name: node.name,
                    _messageId: message.requestId,
                    _endpointId: message.execution.devices[0].id,
                    _confId: node.confId,
                    command: message.execution.execution[0].command,
                    params: message.execution.execution[0].params
                }
            }

            var respond = true;
            var messageId;

            //console.log("Message: " + JSON.stringify(message));

            // Alexa Message Handler
            if (messageFormat == "Alexa") {
                if (message.directive.header.hasOwnProperty('messageId')){messageId = message.directive.header.messageId};               
                switch(message.directive.header.name){
                    case "Activate":
                        // Scene Controller
                        msg.payload = "ON"
                        break;
                    case "AdjustBrightness":
                        // Brightness % command
                        msg.payload = message.directive.payload.brightnessDelta;
                        break;
                    case "AdjustPercentage":
                        // Percentage Controller command
                        msg.payload = message.directive.payload.percentageDelta;               
                        break;
                    case "AdjustRangeValue":
                        // Range Controller command
                        msg.payload = message.directive.payload.rangeValueDelta;               
                        break;                    
                    case "AdjustTargetTemperature":
                        // Thermostat command
                        msg.payload = message.directive.payload.targetSetpointDelta.value;
                        msg.temperatureScale = message.directive.payload.targetSetpointDelta.scale;
                        break;
                    case "AdjustVolume":
                        // Alexa.StepSpeaker
                        if (message.directive.payload.hasOwnProperty('volumeSteps')){msg.payload = message.directive.payload.volumeSteps}
                        // Alexa.Speaker
                        else if (message.directive.payload.hasOwnProperty('volume')){msg.payload = message.directive.payload.volume}
                        break;
                    case "ChangeChannel":
                        // Change channel command
                        if (typeof message.directive.payload.channel.number != 'undefined') {
                            msg.payload = message.directive.payload.channel.number
                        }
                        else if (message.directive.payload.channelMetadata.hasOwnProperty('name')) {
                            msg.payload = message.directive.payload.channelMetadata.name
                        }
                        break;
                    case "Lock":
                        // Lock command
                        msg.payload = "Lock";               
                        break;
                    case "SelectInput":
                        // Select input command
                        msg.payload = message.directive.payload.input;
                        break;
                    case "SetBrightness":
                        // Brightness % command
                        msg.payload = message.directive.payload.brightness;
                        break;
                    case "SetColor":
                        // Color command
                        msg.payload = message.directive.payload.color;               
                        break;
                    case "SetColorTemperature":
                        // Color command
                        msg.payload = message.directive.payload.colorTemperatureInKelvin;               
                        break;
                    case "SetMute":
                        // Mute command
                        if (message.directive.payload.mute == false) {msg.payload = "OFF"};
                        if (message.directive.payload.mute == true) {msg.payload = "ON"};
                        break;
                    case "SetPercentage":
                        // Percentage Controller  command
                        msg.payload = message.directive.payload.percentage;               
                        break;
                    case "SetRangeValue":
                        // Range Controller  command
                        msg.payload = message.directive.payload.rangeValue;               
                        break;
                    case "SetTargetTemperature":
                        // Thermostat command
                        msg.payload = message.directive.payload.targetSetpoint.value;
                        msg.temperatureScale = message.directive.payload.targetSetpoint.scale;
                        break;
                    case "SetThermostatMode":
                        // Thermostat command
                        msg.payload = message.directive.payload.thermostatMode.value;               
                        break;
                    case "SetVolume":
                        // Speaker command
                        msg.payload = message.directive.payload.volume;               
                        break;
                    case "TurnOn":
                        // Power-on command
                        msg.payload = "ON";
                        break;
                    case "TurnOff":
                        // Power-off command
                        msg.payload = "OFF";
                        break;
                    case "Unlock":
                        // Unlock command
                        msg.payload = "Unlock";               
                        break;
                }
            }

            // Google Home Message Handler
            else if (messageFormat == "Google Home") {
                if (message.hasOwnProperty('requestId')){messageId = message.requestId};
                switch (msg.command) {
                    case "action.devices.commands.ActivateScene" :
                        msg.command = "Activate"
                        msg.payload = "ON"
                        break;
                    case "action.devices.commands.BrightnessAbsolute":
                        if (msg.params.hasOwnProperty('brightness')) {
                            msg.command = "SetBrightness"
                            msg.payload = msg.params.brightness;
                        }
                        break;
                    case "action.devices.commands.ColorAbsolute":
                        if (msg.params.color.hasOwnProperty('temperature')) {
                            msg.command = "SetColorTemperature";
                            msg.payload = msg.params.color.temperature;     
                        }
                        if (msg.params.color.hasOwnProperty('spectrumHSV')) {
                            msg.command = "SetColor";
                            msg.payload = {
                                hue: msg.params.color.spectrumHSV.hue,
                                saturation: msg.params.color.spectrumHSV.saturation,
                                brightness: msg.params.color.spectrumHSV.value
                            }
                        }   
                        break;
                    case "action.devices.commands.OnOff" :
                        if (msg.params.on == true) {
                            msg.command = "TurnOn";
                            msg.payload = "ON";
                        }
                        else if (msg.params.on == false) {
                            msg.command = "TurnOff";
                            msg.payload = "OFF";
                        }
                        break;
                    case "action.devices.commands.ThermostatTemperatureSetpoint" :
                        if (msg.params.hasOwnProperty('thermostatTemperatureSetpoint')) {
                            msg.command = "SetTargetTemperature";
                            msg.payload = msg.params.thermostatTemperatureSetpoint;
                        }
                        break;
                    case "action.devices.commands.ThermostatSetMode" :
                        if (msg.params.hasOwnProperty('thermostatMode')) {
                            msg.command = "SetThermostatMode";
                            msg.payload = msg.params.thermostatMode.toUpperCase();
                        }
                        break;
                }

            }

            if (node.acknowledge) {
                msg.acknowledge = {};
                msg.acknowledge = true;
            }
            else {
                msg.acknowledge = {};
                msg.acknowledge = false;   
            }

            node.send(msg);

            if (node.acknowledge && respond && messageId) {
                node.conf.acknowledge(messageId, node.device, true);
            }
        }

        node.conf.register(node);

        node.on('close', function(done){
            node.conf.deregister(node, done);
        });

    }

   // Re-branded for v3 API
    RED.nodes.registerType("alexa-smart-home-v3", alexaHome);

    // Think this is OK for v3 API
    function alexaHomeResponse(n) {
        RED.nodes.createNode(this,n);

        var node = this;

        node.on('input',function(msg){
            if (msg._messageId && msg._endpointId && msg._confId) {
                var conf = RED.nodes.getNode(msg._confId);
                if (typeof msg.acknowledge == 'boolean' && msg.acknowledge) {
                    conf.acknowledge(msg._messageId, msg._endpointId, true);
                } else {
                    conf.acknowledge(msg._messageId, msg._endpointId, false);
                }
            }
        });
    }

    // ##########################################################

    // Set State Node
    function alexaHomeState(n) {
        RED.nodes.createNode(this,n);
    	this.conf = RED.nodes.getNode(n.conf);
        this.confId = n.conf;
    	this.device = n.device;
        this.name = n.name;
        this.type = n.type;
        var nodeContext = this.context();
        var node = this;
        var onGoingCommands = {};
        // Timer to rate limit messages
        var timer = setInterval(function() {    
            var now = Date.now();
            var keys = Object.keys(onGoingCommands);
            var key;
            nodeContext.set('tmpCommand',""); 
            nodeContext.set('tmpKey',"");
            for (key in keys){
                var stateUpdate= onGoingCommands[keys[key]];
                if (stateUpdate) {
                    if (!nodeContext.get('tmpCommand') || nodeContext.get('tmpCommand') == "") { // Capture first state update
                        nodeContext.set('tmpCommand',onGoingCommands[keys[key]]);
                        nodeContext.set('tmpKey',key);
                    }
                    else { // If newer command same as previous, delete previous
                        //console.log("debug, Timer GET stateUpdate keys:" + Object.keys(stateUpdate.payload.state));
                        //console.log("debug, Timer GET tmpCommand keys:" + Object.keys(nodeContext.get('tmpCommand').payload.state));
                        
                        // if (Object.keys(stateUpdate.payload.state).toString() == Object.keys(nodeContext.get('tmpCommand').payload.state).toString() && stateUpdate.messageId != nodeContext.get('tmpCommand').messageId) {
                        if (Object.keys(stateUpdate.payload.state).toString() == Object.keys(nodeContext.get('tmpCommand').payload.state).toString()) {
                            node.log("Timer throttled/ deleted state update: " + keys[nodeContext.get('tmpKey')]);
                            delete onGoingCommands[keys[nodeContext.get('tmpKey')]];
                            nodeContext.set('tmpCommand',onGoingCommands[keys[key]]); 
                            nodeContext.set('tmpKey',key);
                        }
                        else {
                            //console.log("debug, Timer No match of object keys");
                            nodeContext.set('tmpCommand',onGoingCommands[keys[key]]);
                            nodeContext.set('tmpKey',key);
                        }
                    }
                    var diff = now - stateUpdate.timestamp;
                    if (diff > 1000) {
                        node.conf.updateState(stateUpdate.messageId, stateUpdate.endpointId, stateUpdate.payload, node.name);
                        //console.log("debug, Timer sent state update: " + keys[key]);
                        delete onGoingCommands[keys[key]];
                    }
                }
            }
        }, 250); // 250 Millisecond Timer

        // Store timer Id in node content 
        nodeContext.set("timer",timer);
        
        // Set State Node On Input Function
        node.on('input',function(msg){
            // State update could be for any state(s), validate the state message falls within expected params
            var stateValid = true;
            // Handle AlexaHome output
            if (msg.command == "AdjustPercentage"){msg.payload={"state":{"percentageDelta":msg.payload}}}
            else if (msg.command == "AdjustTargetTemperature"){msg.payload={"state":{"targetSetpointDelta":msg.payload}}}
            else if (msg.command == "AdjustVolume"){msg.payload={"state":{"volumeDelta":msg.payload}}}
            else if (msg.command == "AdjustRangeValue"){msg.payload={"state":{"rangeValueDelta":msg.payload}}}
            else if (msg.command == "Lock"){msg.payload = {"state":{"lock":"LOCKED"}}}
            else if (msg.command == "SetBrightness"){msg.payload = {"state":{"brightness":msg.payload}}}
            else if (msg.command == "SetColor"){msg.payload={"state":{"colorHue": msg.payload.hue,"colorSaturation":msg.payload.saturation,"colorBrightness":msg.payload.brightness}}}
            else if (msg.command == "SetColorTemperature"){msg.payload = {"state":{"colorTemperature":msg.payload}}}
            else if (msg.command == "SelectInput"){msg.payload={"state":{"input":msg.payload}}}
            else if (msg.command == "SetPercentage"){msg.payload={"state":{"percentage":msg.payload}}}
            else if (msg.command == "SetRangeValue"){msg.payload={"state":{"rangeValue":msg.payload}}}
            else if (msg.command == "SetTargetTemperature"){msg.payload={"state":{"thermostatSetPoint":msg.payload}}}
            else if (msg.command == "SetThermostatMode"){msg.payload={"state":{"thermostatMode":msg.payload}}}
            else if (msg.command == "SetVolume"){msg.payload={"state":{"volume":msg.payload}}}
            else if (msg.command == "TurnOff" || msg.command == "TurnOn"){msg.payload={"state":{"power":msg.payload}}}
            else if (msg.command == "Unlock"){msg.payload={"state":{"lock":"UNLOCKED"}}}
            else {
                if (msg.command){node.warn("State update message object includes invalid msg.command, please remove this from payload: " + msg.command)};
            }

            if (nodeContext.get('lastPayload') && msg.payload.hasOwnProperty('state')) {
                //console.log("debug, ON Message, lastpayload: " + JSON.stringify(nodeContext.get('lastPayload')));
                //console.log("debug, ON Message, msg.payload: " + JSON.stringify(msg.payload));

                // Duplicate Payload to last payload received, discard unless an adjustment payload which is likely to be duplicate
                if (JSON.stringify(nodeContext.get('lastPayload')) == JSON.stringify(msg.payload)
                 && !(msg.payload.state.hasOwnProperty('percentageDelta') 
                    || msg.payload.state.hasOwnProperty('targetSetpointDelta') 
                    || msg.payload.state.hasOwnProperty('volumeDelta'))) {

                    nodeContext.set('duplicatePayload', true);
                }
                // Non-duplicate payload. send to Web API
                else {
                    nodeContext.set('duplicatePayload', false);
                    nodeContext.set('lastPayload',msg.payload);
                }
            } 
            else {
                nodeContext.set('duplicatePayload', false);
                nodeContext.set('lastPayload', msg.payload);
            }

            // Set State Payload Handler
            if (msg.payload.hasOwnProperty('state') && msg.hasOwnProperty('acknowledge') && nodeContext.get('duplicatePayload') == false) {
                // Perform validation of device state payload, expects payload.state to contain as below
                //     "power": payload.state.power,
                //     "brightness": payload.state.brightness,
                //     "colorBrightness": payload.state.colorBrightness,
                //     "colorHue": payload.state.colorHue,
                //     "colorSaturation": payload.state.colorSaturation,
                //     "colorTemperature": payload.state.colorTemperature,
                //     "input": payload.state.input,
                //     "lock": payload.state.lock,
                //     "playback": payload.state.playback,
                //     "percentage": payload.state.percentage,
                //     "percentageDelta": payload.state.percentageDelta,
                //     "temperature": payload.state.temperature,
                //     "targetSetpointDelta": payload.state.targetSetpointDelta,
                //     "thermostatMode": payload.state.thermostatMode,
                //     "thermostatSetPoint" : payload.state.thermostatSetPoint
                //     "volume" : payload.state.thermostatSetPoint
                //     "volumeDelta" : payload.state.thermostatSetPoint

                // Brightness state, expect state to be a number in range of 0-100
                if (msg.payload.state.hasOwnProperty('brightness')) {
                    if (typeof msg.payload.state.brightness != 'number' && msg.payload.state.brightness < 0 && msg.payload.state.brightness > 100) {stateValid = false};
                }
                // Color state, expect state to include hue, saturation and brightness, in range of 0-360 for hue and 0-1 for saturation and brightness
                if (msg.payload.state.hasOwnProperty('colorHue') && msg.payload.state.hasOwnProperty('colorSaturation') && msg.payload.state.hasOwnProperty('colorBrightness')) {
                    if ((typeof msg.payload.state.colorHue != 'number'
                        && typeof msg.payload.state.colorSaturation != 'number'
                        && typeof msg.payload.state.colorBrightness != 'number'
                        && msg.payload.state.colorHue < 0 && msg.payload.state.colorHue > 360)
                        && (msg.payload.state.colorSaturation < 0 && msg.payload.state.colorSaturation > 1)
                        && (msg.payload.state.colorBrightness < 0 && msg.payload.state.colorBrightness > 1)) {
                            stateValid = false;
                        }
                }
                // Color Temperature, expect state to include colorTemperatureInKelvin, in range of 0-10000
                if (msg.payload.state.hasOwnProperty('colorTemperature')) {
                    if (typeof msg.payload.state.colorTemperature != 'number' && (msg.payload.state.colorTemperature < 0 && msg.payload.state.colorTemperature) > 10000) {stateValid = false};
                }
                // Input state, expect string, inputs will grow so no point in specific string checking
                if (msg.payload.state.hasOwnProperty('input')) {
                    if (typeof msg.payload.state.input != 'string') {stateValid = false};
                }
                // Lock state, expect string, either LOCKED or UNLOCKED
                if (msg.payload.state.hasOwnProperty('lock')) {
                    if (typeof msg.payload.state.lock != 'string' && (msg.payload.state.lock != "LOCKED" || msg.payload.state.lock != "UNLOCKED")) {stateValid = false};
                }
                // Percentage state, expect state top be number between 0 and 100
                if (msg.payload.state.hasOwnProperty('percentage')) {
                    if (typeof msg.payload.state.percentage != 'number' && (msg.payload.state.percentage < 0 || msg.payload.state.percentage > 100)) {stateValid = false};
                }
                // PercentageDelta state, expect state top be number between 0 and 100
                if (msg.payload.state.hasOwnProperty('percentageDelta')) {
                    if (typeof msg.payload.state.percentageDelta != 'number' && (msg.payload.state.percentageDelta < -100 || msg.payload.state.percentageDelta > 100)) {stateValid = false};
                }
                // Power state, expect state to be string, either ON or OFF
                if (msg.payload.state.hasOwnProperty('power')) {
                    if (typeof msg.payload.state.power != 'string' && (msg.payload.state.power != 'ON' || msg.payload.state.power != 'OFF')) {stateValid = false};
                }
                // Temperature sensor state, expect state to be a number
                if (msg.payload.state.hasOwnProperty('temperature')) {
                    if (typeof msg.payload.state.temperature != 'number') {stateValid = false};
                }
                // ThermostatMode state, expect state to be a number
                if (msg.payload.state.hasOwnProperty('thermostatMode')) {
                    if (typeof msg.payload.state.thermostatMode != 'string') {stateValid = false};
                }
                // TargetSetpointDelta state, expect state to be a number
                if (msg.payload.state.hasOwnProperty('targetSetpointDelta')) {
                    if (typeof msg.payload.state.targetSetpointDelta != 'number') {stateValid = false};
                }
                // ThermostatSetPoint state, expect state to be a number
                if (msg.payload.state.hasOwnProperty('thermostatSetPoint')) {
                    if (typeof msg.payload.state.thermostatSetPoint != 'number') {stateValid = false};
                }
                // Volume state, expect state to be a number
                if (msg.payload.state.hasOwnProperty('volume')) {
                    if (typeof msg.payload.state.volume != 'number') {stateValid = false};
                }
                // VolumeDelta state, expect state to be a number
                if (msg.payload.state.hasOwnProperty('volumeDelta')) {
                    if (typeof msg.payload.state.volumeDelta != 'number') {stateValid = false};
                }
                if (stateValid && msg.acknowledge == true) {
                    // Send messageId, deviceId, capability and payload to updateState
                    var messageId = uuid();
                    //node.conf.updateState(messageId, this.device, msg.payload);
                    var command = {
                        messageId: messageId,
                        endpointId: this.device,
                        payload: msg.payload,
                        timestamp: Date.now()
                    };
                    onGoingCommands[messageId] = command;
                }
                else if (stateValid && msg.acknowledge != true) {
                    // Either auto-acknowledge is enabled on sender node, or validation has taken place
                    node.warn("Valid state update but msg.payload.acknowledge is false/ invalid/ missing");
                }
                else {
                    // State update not valid, logic above will explain why
                    node.warn("State update payload not valid, check data types/ format");
                }
            }
            // State missing
            else if (!msg.payload.hasOwnProperty('state')) { 
                node.warn("State update message object missing msg.payload.state");
            }
            // Acknowledge missing
            else if (!msg.hasOwnProperty('acknowledge')) { 
                node.warn("State update message missing msg.acknowledge");
            }
            // Duplicate State Update
            else if (nodeContext.get('duplicatePayload') == true) { 
                node.log("Discarded duplicate state payload");
            }
        });

        node.conf.register(node);

        node.on('close', function(done){
            node.conf.deregister(node, done);
            clearInterval(nodeContext.get("timer")); // Close Interval Timer used node contexrt stored Id
        });
    }
    
    // ##########################################################

    // Re-branded for v3 API
    RED.nodes.registerType("alexa-smart-home-v3-resp", alexaHomeResponse);

    // New Node Type for State Reporting to Web App
    RED.nodes.registerType("alexa-smart-home-v3-state", alexaHomeState);

    // Re-branded for v3 API
    RED.httpAdmin.use('/alexa-smart-home-v3/new-account',bodyParser.json());

    // Shouldn't need a change?
    // ## Changed to include url in expected params
    function getDevices(url, username, password, id){
        if (url && username && password) {
            request.get({
                url: "https://" + url + "/api/v1/devices",
                auth: {
                    username: username,
                    password: password
                }
            }, function(err, res, body){
                if (!err && res.statusCode == 200) {
                    var devs = JSON.parse(body);
                    //console.log(devs);
                    devices[id] = devs;
                } else {
                    //console.("err: " + err);
                    RED.log.log("Problem looking up " + username + "'s devices");
                }
            });
        }
    };

    // UUID Generator
    function uuid() {
        var uuid = "", i, random;
        for (i = 0; i < 32; i++) {
          random = Math.random() * 16 | 0;
      
          if (i == 8 || i == 12 || i == 16 || i == 20) {
            uuid += "-"
          }
          uuid += (i == 12 ? 4 : (i == 16 ? (random & 3 | 8) : random)).toString(16);
        }
        return uuid;
      }

    // Re-branded for v3 API
    RED.httpAdmin.post('/alexa-smart-home-v3/new-account',function(req,res){
        console.log("httpAdmin post", req.body);
    	var username = req.body.user;
        var password = req.body.pass;
        var url = req.body.webapi;
        var id = req.body.id;
        // ## Modified
    	getDevices(url, username,password,id);
    });

    // Re-branded for v3 API
    RED.httpAdmin.post('/alexa-smart-home-v3/refresh/:id',function(req,res){
        var id = req.params.id;
        var conf = RED.nodes.getNode(id);
        if (conf) {
            var username = conf.username;
            var password = conf.credentials.password;
            var url = conf.webapiurl;
            getDevices(url, username,password,id);
            res.status(200).send();
        } else {
            //not deployed yet
            node.warn("Can't refresh devices until deployed");
            res.status(404).send();
        }
    });

    // Re-branded for v3 API
    RED.httpAdmin.get('/alexa-smart-home-v3/devices/:id',function(req,res){
    	if (devices[req.params.id]) {
    		res.send(devices[req.params.id]);
    	} else {
    		res.status(404).send();
    	}
    });


};

