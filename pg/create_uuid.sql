drop function if exists fp.create_uuid();

create or replace function fp.create_uuid() returns text as $$
  return (function () {
    if (!plv8._init) { plv8.execute('select fp.init()'); }

    return FP.createUuid();
  }());
$$ language plv8;