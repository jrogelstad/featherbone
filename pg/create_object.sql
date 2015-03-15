do $$
   plv8.execute('select fp.init()');
   var sql = "select * from pg_tables where schemaname = 'fp' and tablename = 'object';";
   
   if (!plv8.execute(sql).length) {
     sql = "create table fp.object (" +
       "id bigserial primary key," +
       "guid text not null default fp.create_uuid() unique," +
       "created timestamp with time zone not null default now()," +
       "created_by text not null default fp.get_current_user()," +
       "updated timestamp with time zone not null default now()," +
       "updated_by text not null default fp.get_current_user())";
     plv8.execute(sql);
     plv8.execute("comment on table fp.object is 'Abstract object from which all objects will inherit.'");
     sql = "comment on column %I.%I.%I is %L";
     plv8.execute(FP.formatSql(sql, ['fp','object','id','Primary key']));
     plv8.execute(FP.formatSql(sql, ['fp','object','guid','Surrogate key']));
     plv8.execute(FP.formatSql(sql, ['fp','object','created','Create time of the record']));
     plv8.execute(FP.formatSql(sql, ['fp','object','created_by','User who created the record']));
     plv8.execute(FP.formatSql(sql, ['fp','object','updated','Last time the record was updated']));
     plv8.execute(FP.formatSql(sql, ['fp','object','updated_by','Last user who created the record']));
   };
$$ language plv8;