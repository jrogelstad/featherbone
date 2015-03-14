drop function if exists fp.get_current_user();

create or replace function fp.get_current_user() returns text as $$

  return (function () {

    if (!plv8._init) { plv8.execute('select fb.init()'); }

    return FP.getCurrentUser();

  }());

$$ language plv8;