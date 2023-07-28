Featherbone
===========
A JavaScript based persistence framework for building object relational database applications.

# Prerequisites
* [PostgreSQL v14.8.0](http://www.postgresql.org/)
* [NodeJS v16.20.1](https://nodejs.org/en/)
  
# Install

On the first install you will need to pass credentials of a postgres superuser that can create the database and grant permissions to your adminstrative service user defined [here](https://github.com/FeatherboneJS/featherbone/blob/master/server/config.json).

Either download and unzip the latest release, or clone this repository and from the destination location:

```text
$ npm install
$ node install --username postgres --password <your password>
$ node server
```

From your browser navigate to <http://localhost/demo> to run the application where the last part of the path is the name of your database. Use the same username and password as specified as in your PostgreSQL [configuration](https://github.com/FeatherboneJS/featherbone/blob/master/server/config.json) service user ("admin"/"password" by default) to sign in.

A documentation server may be installed from [here](https://github.com/jrogelstad/featherbone-docs)
