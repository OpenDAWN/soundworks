/**
 * @fileoverview Soundworks server side socket i/o (singleton)
 * @author Sebastien.Robaszkiewicz@ircam.fr, Norbert.Schnell@ircam.fr
 */
'use strict';

var express = require('express');
var http = require('http');
var IO = require('socket.io');
var ServerClient = require('./ServerClient');
const log = require('./logger');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');

var expressApp = null;
var httpServer = null;

var server = {
  io: null,
  start: start,
  map: map,
  broadcast: broadcast,
  envConfig: {} // host env config informations (dev / prod)
};

var availableClientIndices = [];
var nextClientIndex = 0;

function getClientIndex() {
  var index = -1;

  if (availableClientIndices.length > 0) {
    availableClientIndices.sort(function(a, b) {
      return a - b;
    });

    index = availableClientIndices.splice(0, 1)[0];
  } else {
    index = nextClientIndex++;
  }

  return index;
}

function releaseClientIndex(index) {
  availableClientIndices.push(index);
}

function start(app, publicPath, port, socketOptions = {}, envConfig = {}) {
  const socketConfig = {
    transports: socketOptions.transports || ['websocket'],
    pingTimeout: socketOptions.pingTimeout || 60000,
    pingInterval: socketOptions.pingInterval || 50000
  };

  server.envConfig = envConfig;

  app.set('port', process.env.PORT || port || 8000);
  app.set('view engine', 'ejs');
  app.use(express.static(publicPath));

  httpServer = http.createServer(app);
  expressApp = app;

  httpServer.listen(app.get('port'), function() {
    console.log('Server listening on port', app.get('port'));
  });

  // Engine IO defaults
  // this.pingTimeout = opts.pingTimeout || 3000;
  // this.pingInterval = opts.pingInterval || 1000;
  // this.upgradeTimeout = opts.upgradeTimeout || 10000;
  // this.maxHttpBufferSize = opts.maxHttpBufferSize || 10E7;

  if (httpServer) {
    server.io = new IO(httpServer, socketConfig);
  }
}

const clientTypeTemplateMap = new Map();

function map(clientType, ...modules) {
  var url = '/';

  // cache compiled template
  const tmplPath= path.join(process.cwd(), 'views', clientType + '.ejs');
  const tmplString = fs.readFileSync(tmplPath, { encoding: 'utf8' });
  const tmpl = ejs.compile(tmplString);

  if (clientType !== 'player')
    url += clientType;

  expressApp.get(url, function(req, res) {
    res.send(tmpl({ envConfig: JSON.stringify(server.envConfig) }));
  });

  server.io.of(clientType).on('connection', (socket) => {
    log.info({ socket: socket, clientType: clientType }, 'connection');
    var client = new ServerClient(clientType, socket);

    var index = getClientIndex();
    client.index = index;

    for (let mod of modules) {
      mod.connect(client);
    }

    client.receive('disconnect', () => {
      log.info({ socket: socket, clientType: clientType }, 'disconnect');
      for (let i = modules.length - 1; i >= 0; i--) {
        var mod = modules[i];
        mod.disconnect(client);
      }

      releaseClientIndex(client.index);
      client.index = -1;
    });

    client.send('client:start', index); // the server is ready
  });
}

function broadcast(clientType, msg, ...args) {
  if (server.io) {
    log.info({ clientType: clientType, channel: msg, arguments: args }, 'broadcast');
    server.io.of('/' + clientType).emit(msg, ...args);
  }
}

module.exports = server;