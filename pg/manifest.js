{
    "version": "0.0.1",
    "files": [
        {
            "type": "execute",
            "path": "tables.js"
        },
        {
            "type": "function",
            "path": "init.js"
        },
        {
            "type": "function",
            "path": "request.js",
            "args": {
                "obj": {
                    "type": "json"
                },
                "init": {
                    "type": "boolean",
                    "defaultValue": "false"
                }
            },
            "returns": "json"
        },
        {
            "type": "script",
            "path": "jsonpatch.js"
        },
        {
            "type": "script",
            "path": "featherbone.js",
            "requires": [
                "jsonpatch"
            ]
        },
        {
            "type": "feather",
            "path": "feathers.js"
        },
        {
            "type": "execute",
            "path": "populate.js"
        }
    ]
}

