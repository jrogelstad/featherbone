do $$
   var sql = "select * from information_schema.schemata where schema_name = 'fp'";

   if (!plv8.execute(sql).length) {
     plv8.execute('create schema fp');
   };
$$ language plv8;