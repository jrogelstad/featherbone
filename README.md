Featherbone
===========
A JavaScript based persistence framework for building object relational database applications.

# Prerequisites
* [PostgreSQL v9.6.6](http://www.postgresql.org/)
* [NodeJS v8.9.1](https://nodejs.org/en/)
  
# Install

Make sure your Postgres installation matches the credentials [here](https://github.com/jrogelstad/featherbone/blob/master/config/pg.json), or modify the configuration file to match your administrator credentials. If the database specified does not exist, it will be created automatically.

Clone this repository and from the cloned location:

```text
$ npm install
$ node configure
$ node server
```

From your browser navigate to <http://localhost:10001> to run the application.

An additional example module may be loaded [here](https://github.com/jrogelstad/cardinal)
