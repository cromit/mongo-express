/**
 * Module dependencies.
 */

var express = require('express')
  , routes = require('./routes')
  , http = require('http');

var _ = require('underscore');
var async = require('async');
var utils = require('./utils');

var mongodb = require('mongodb');
var cons = require('consolidate');
var swig = require('swig');
var swigFilters = require('./filters');
var app = express();

var config = require('./config');

// String formatting
if (!String.prototype.format) {
  String.prototype.format = function() {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function(match, number) { 
      return typeof args[number] != 'undefined'
        ? args[number]
        : match
      ;
    });
  };
}

//Set up swig
app.engine('html', cons.swig);
swig.init({
  root: __dirname + '/views',
  allowErrors: false,
  filters: swigFilters
});

//App configuration
app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'html');
  app.set('view options', {layout: false});
  app.use(express.favicon());
  app.use(express.logger('dev'));
  app.use(config.site.baseUrl,express.static(__dirname + '/public'));
  app.use(express.bodyParser());
  app.use(express.cookieParser(config.site.cookieSecret));
  app.use(express.session({ secret: config.site.sessionSecret }));
  app.use(express.methodOverride());
  app.use(app.router);
});

app.configure('development', function(){
  app.use(express.errorHandler());
});

//var connections = {};
//var databases = [];
//var collections = {};
var mongodbs = {};

/*
  mongodbs = { 
    HOST_DB_KEY : {
      error : undefined,
      dbObj : db,
      dbName : dbName.
      hostName : hostNAme
      collections : {}
    }
  }
*/

// Initialize multiple mongodb connections
var initMongoDBs = function() {
  console.log("Initialize MongoDBs");

  for (var dbHost in config.mongodb) {
    var dbConfig = config.mongodb[dbHost];
    //Set up database stuff
    var connectionString;
    var dbName;

    if (dbConfig.connectionString === undefined) {
      var host = dbConfig.server || 'localhost';
      var port = dbConfig.port || mongodb.Connection.DEFAULT_PORT;

      var accountInfo;
      if (typeof dbConfig.username != "undefined" && dbConfig.username.length !== 0) {
        accountInfo = "{0}:{1}".format(dbConfig.username, dbConfig.password);
        dbConfig.connectionString = "mongodb://{0}:{1}@{2}:{3}/{4}".format(dbConfig.username, dbConfig.password, host, port, dbConfig.database);
      } else {
        dbConfig.connectionString = "mongodb://{0}:{1}/{2}".format(host, port, dbConfig.database);
      }
      dbName = dbConfig.database;
    } else {
      var url = require('url');
      var connectionUri = url.parse(dbConfig.connectionString);
      dbName = connectionUri.pathname.replace(/^\//, '');
    }

    console.log("Connecting to MongoDB %s:%s", dbHost, dbName);

    (function(dbHost, dbName) {
      mongodb.MongoClient.connect(dbConfig.connectionString, function(err, db) {
        connectionKey = "{0}@{1}".format(dbName, dbHost);

        if (err) {
          mongodbs[connectionKey] = { err: err };
          console.log("URI CONNECTING ERROR %s", err);
          console.log(mongodbs);
        } else {
          mongodbs[connectionKey] = {
            dbObj: db,
            dbHost: dbHost,
            dbName: dbName
          };
          onConnectedToDB(connectionKey);

          console.log("URI CONNECTECD %s", db.databaseName);
        }
      });
    })(dbHost, dbName);
  }
};
initMongoDBs();

var onConnectedToDB = function(connectionKey) {
  var mongodbInfo = mongodbs[connectionKey];

  console.log("OnConnect %s:%s", mongodbInfo.dbHost, mongodbInfo.dbName);
  //Check if admin features are on
  if (config.mongodb[mongodbInfo.dbHost].admin === true) {
    //get admin instance
    var adminConf = config.mongodb[mongodbInfo.dbHost];
    var adminDb = mongodbInfo.dbObj.admin();

    if (adminConf.adminUsername.length === 0) {
      console.log('Admin Database connected');
      updateDatabases(adminDb);
    } else {
      adminDb.authenticate(adminConf.adminUsername, adminConf.adminPassword, function(err, replies) {
        if (err) {
           console.error(err);
        } else {
          console.log('Admin Database connected');
          updateDatabases(adminDb);
        }
      });
    }
  }

  updateCollections(mongodbInfo.dbObj, connectionKey);
};

//Update the collections list
var updateCollections = function(db, connectionKey, callback) {
  db.collectionNames(function (err, result) {
    var names = [];

    for (var r in result) {
      var coll = utils.parseCollectionName(result[r].name);
      names.push(coll.name);
    }

    mongodbs[connectionKey].collections = names.sort();

    if (callback) {
      callback(err);
    }
  });
};

//Update database list
var updateDatabases = function(admin) {
  admin.listDatabases(function(err, dbs) {
    if (err) {
      //TODO: handle error
      console.error(err);
    }

    for (var key in dbs.databases) {
      var dbName = dbs.databases[key]['name'];

      //'local' is special database, ignore it
      if (dbName == 'local') {
        continue;
      }

      if (config.mongodb.whitelist.length != 0) {
        if (!_.include(config.mongodb.whitelist, dbName)) {
          continue;
        }
      }
      if (config.mongodb.blacklist.length != 0) {
        if (_.include(config.mongodb.blacklist, dbName)) {
          continue;
        }
      }

      connections[dbName] = mainConn.db(dbName);
      databases.push(dbName);

      updateCollections(connections[dbName], dbName);
    }

    //Sort database names
    databases = databases.sort();
  });
};


//View helper, sets local variables used in templates
app.all('*', function(req, res, next) {
  var ip_address = null;
  if (req.headers['x-forwarded-for']){
    ip_address = req.headers['x-forwarded-for'];
  }
  else {
    ip_address = req.connection.remoteAddress;
  }

  if (config.site.allowRemoteAddress.indexOf(ip_address) < 0) {
    var ctx = {
      title: "Not allowed remote address."
    };
    return res.render('index', ctx);
  }

  res.locals.baseHref = config.site.baseUrl;
  res.locals.mongodbs = mongodbs;

  //console.trace("Here I am!");
  //console.log(databases);
  //Flash messages
  for (var dbKey in res.locals.mongodbs) {
    console.log(dbKey);

  }

  if (req.session.success) {
    res.locals.messageSuccess = req.session.success;
    delete req.session.success;
  }

  if (req.session.error) {
    res.locals.messageError = req.session.error;
    delete req.session.error;
  }

  return next();
});


//route param pre-conditions
app.param('database', function(req, res, next, id) {
  //Make sure database exists
  console.log("Database! id:" + id);
  
  if ((id in mongodbs) === false) {
    req.session.error = "Database not found!";
    return res.redirect(config.site.baseUrl);
  }

  req.dbName = id;
  req.collections = mongodbs[id].collections;
  res.locals.dbName = id;
  res.locals.collections = mongodbs[id].collections;

  if (mongodbs[id] !== undefined) {
    req.db = mongodbs[id].dbObj;
  } else {
    connections[id] = mainConn.db(id);
    req.db = connections[id];
  }

  next();
});

//:collection param MUST be preceded by a :database param
app.param('collection', function(req, res, next, id) {
  //Make sure collection exists
  console.log("Collection! id:" + id);
  
  collections = mongodbs[req.dbName].collections;
  //
  if (!_.include(collections, id)) {
    req.session.error = "Collection not found!";
    return res.redirect(config.site.baseUrl+'db/' + req.dbName);
  }

  req.collectionName = id;
  res.locals.collectionName = id;

  mongodbs[req.dbName].dbObj.collection(id, function(err, coll) {
    if (err || coll == null) {
      req.session.error = "Collection not found!";
      return res.redirect(config.site.baseUrl+'db/' + req.dbName);
    }

    req.collection = coll;

    next();
  });
});

//:document param MUST be preceded by a :collection param
app.param('document', function(req, res, next, id) {
  if (id.length == 24) {
    //Convert id string to mongodb object ID
    try {
      id = new mongodb.ObjectID.createFromHexString(id);
    } catch (err) {
    }
  }

  req.collection.findOne({_id: id}, function(err, doc) {
    if (err || doc == null) {
      req.session.error = "Document not found!";
      return res.redirect(config.site.baseUrl+'db/' + req.dbName + '/' + req.collectionName);
    }

    req.document = doc;
    res.locals.document = doc;

    next();
  });
});


//mongodb middleware
var middleware = function(req, res, next) {
  req.mongodbs = mongodbs; //List of databases

  //Allow page handlers to request an update for collection list
  req.updateCollections = updateCollections;

  next();
};

//Routes
app.get(config.site.baseUrl, middleware,  routes.index);

app.get(config.site.baseUrl+'db/:database/:collection/:document', middleware, routes.viewDocument);
app.put(config.site.baseUrl+'db/:database/:collection/:document', middleware, routes.updateDocument);
app.del(config.site.baseUrl+'db/:database/:collection/:document', middleware, routes.deleteDocument);
app.post(config.site.baseUrl+'db/:database/:collection', middleware, routes.addDocument);

app.get(config.site.baseUrl+'db/:database/:collection', middleware, routes.viewCollection);
app.put(config.site.baseUrl+'db/:database/:collection', middleware, routes.renameCollection);
app.del(config.site.baseUrl+'db/:database/:collection', middleware, routes.deleteCollection);
app.post(config.site.baseUrl+'db/:database', middleware, routes.addCollection);

app.get(config.site.baseUrl+'db/:database', middleware, routes.viewDatabase);

//run as standalone App?
if (require.main === module){
  var port = process.env.PORT || config.site.port;
  app.listen(port);
  console.log("Mongo Express server listening on port " + (port || 80));
}else{
  //as a module
  console.log('Mongo Express module ready to use on route "'+config.site.baseUrl+'*"');
  server=http.createServer(app);  
  module.exports=function(req,res,next){    
    server.emit('request', req, res);
  };
}


