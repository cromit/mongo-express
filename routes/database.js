exports.viewDatabase = function(req, res) {
  var ctx = {
    title: 'Viewing Database: ' + req.dbName,
    colls: req.collections
  };
  res.render('database', ctx);
}
