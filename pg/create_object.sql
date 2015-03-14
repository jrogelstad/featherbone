do $$
   var sql = "select * from pg_tables where schemaname = 'fp' and tablename = 'object';";
   
   if (!plv8.execute(sql).length) {
     sql = "create table fp.object (" +
       "id bigserial primary key," +
       "guid text not null default fp.create_uuid() unique," +
       "created timestamp with time zone not null default now()," +
       "created_by text not null default fp.get_current_user()," +
       "updated time with time zone not null default now()," +
       "updated_by text not null default fp.get_current_user())";
     plv8.execute(sql);
   };

$$ language plv8;
drop table fp.object