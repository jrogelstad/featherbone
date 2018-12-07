{
	"openapi": "3.0.0",
	"info": {
		"version": "1.0.2",
		"title": "Featherbone data service",
		"description": "REST data service for featherbone based applications.",
		"license": {
			"name": "Affero GPLv3",
			"url": "http://www.gnu.org/licenses/agpl.txt"
		}
	},
	"servers": [{
		"url": "http://localhost:10001"
	}],
	"tags": [{
			"name": "feather",
			"description": "Data class specifications"
		},
		{
			"name": "settings",
			"description": "Application settings url"
		}
	],
	"paths": {
		"/settings/{name}": {
			"get": {
				"summary": "Get settings by name",
				"operationId": "getSettings",
				"tags": [
					"settings"
				],
				"parameters": [{
					"name": "name",
					"in": "path",
					"description": "The name of the settings to retrieve",
					"required": true,
					"schema": {
						"type": "string"
					}
				}],
				"responses": {
					"200": {
						"description": "Expected response to a valid request",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/Settings"
								}
							}
						}
					},
					"default": {
						"description": "unexpected error",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/ErrorResponse"
								}
							}
						}
					}
				}
			},
			"put": {
				"tags": [
					"settings"
				],
				"summary": "Save new settings",
				"operationId": "saveSettings",
				"parameters": [{
					"name": "name",
					"in": "path",
					"description": "The name of the settings",
					"required": true,
					"schema": {
						"type": "string"
					}
				}, {
					"name": "data",
					"in": "query",
					"description": "The name of the settings",
					"required": true,
					"schema": {
						"type": "object"
					}
				}],
				"responses": {
					"200": {
						"description": "Expected response to a valid request",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/Settings"
								}
							}
						}
					},
					"default": {
						"description": "unexpected error",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/ErrorResponse"
								}
							}
						}
					}
				}
			}
		},
		"/feather/{name}": {
			"get": {
				"summary": "Get feather by name",
				"operationId": "getFeather",
				"tags": [
					"feather"
				],
				"parameters": [{
					"name": "name",
					"in": "path",
					"description": "The name of the feather to retrieve",
					"required": true,
					"schema": {
						"type": "string"
					}
				}],
				"responses": {
					"200": {
						"description": "Expected response to a valid request",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/Feather"
								}
							}
						}
					},
					"default": {
						"description": "unexpected error",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/ErrorResponse"
								}
							}
						}
					}
				}
			},
			"put": {
				"tags": [
					"feather"
				],
				"summary": "Save feather",
				"operationId": "saveFeather",
				"parameters": [{
					"name": "name",
					"in": "path",
					"description": "The name of the feather",
					"required": true,
					"schema": {
						"type": "string"
					}
				}, {
					"name": "data",
					"in": "query",
					"description": "The feather definition",
					"required": true,
					"schema": {
						"type": "object"
					}
				}],
				"responses": {
					"200": {
						"description": "Expected response to a valid request",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/Feather"
								}
							}
						}
					},
					"default": {
						"description": "unexpected error",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/ErrorResponse"
								}
							}
						}
					}
				}
			},
			"delete": {
				"tags": [
					"feather"
				],
				"summary": "Delete feather",
				"operationId": "deleteFeather",
				"parameters": [{
					"name": "name",
					"in": "path",
					"description": "Delete a feather",
					"required": true,
					"schema": {
						"type": "string"
					}
				}],
				"responses": {
					"200": {
						"description": "Expected response to a valid request",
						"content": {
							"application/json": {
								"schema": {
									"type": "boolean"
								}
							}
						}
					},
					"default": {
						"description": "unexpected error",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/ErrorResponse"
								}
							}
						}
					}
				}
			}
		},
		"/module/": {
			"get": {
				"summary": "Get javascript modules",
				"operationId": "getModules",
				"tags": [
					"module"
				],
				"responses": {
					"200": {
						"description": "Expected response to a valid request",
						"content": {
							"application/json": {
								"schema": {
									"type": "array",
									"items": {
										"$ref": "#/components/schemas/Module"
									}
								}
							}
						}
                    },
                    "default": {
                        "description": "unexpected error",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorResponse"
                                }
                            }
                        }
                    }
				}
			}
		},
		"/workbook/{name}": {
			"get": {
				"summary": "Get workbook by name",
				"operationId": "getWorkbook",
				"tags": [
					"workbook"
				],
				"parameters": [{
					"name": "name",
					"in": "path",
					"description": "The name of the workbook to retrieve",
					"required": true,
					"schema": {
						"type": "string"
					}
				}],
				"responses": {
					"200": {
						"description": "Expected response to a valid request",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/Workbook"
								}
							}
						}
					},
					"default": {
						"description": "unexpected error",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/ErrorResponse"
								}
							}
						}
					}
				}
			},
			"put": {
				"tags": [
					"workbook"
				],
				"summary": "Save Workbook",
				"operationId": "saveWorkbook",
				"parameters": [{
					"name": "name",
					"in": "path",
					"description": "The name of the workbook",
					"required": true,
					"schema": {
						"type": "string"
					}
				}, {
					"name": "data",
					"in": "query",
					"description": "The workbook definition",
					"required": true,
					"schema": {
						"type": "object"
					}
				}],
				"responses": {
					"200": {
						"description": "Expected response to a valid request",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/Workbook"
								}
							}
						}
					},
					"default": {
						"description": "unexpected error",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/ErrorResponse"
								}
							}
						}
					}
				}
			},
			"delete": {
				"tags": [
					"workbook"
				],
				"summary": "Delete workbook",
				"operationId": "deleteWorkbook",
				"parameters": [{
					"name": "name",
					"in": "path",
					"description": "Delete a workbook",
					"required": true,
					"schema": {
						"type": "string"
					}
				}],
				"responses": {
					"200": {
						"description": "Expected response to a valid request",
						"content": {
							"application/json": {
								"schema": {
									"type": "boolean"
								}
							}
						}
					},
					"default": {
						"description": "unexpected error",
						"content": {
							"application/json": {
								"schema": {
									"$ref": "#/components/schemas/ErrorResponse"
								}
							}
						}
					}
				}
			}
		},
		"/workbooks/": {
			"get": {
				"summary": "Get all workbooks",
				"operationId": "getWorkbooks",
				"tags": [
					"workbooks"
				],
				"responses": {
					"200": {
						"description": "Expected response to a valid request",
						"content": {
							"application/json": {
								"schema": {
									"type": "array",
									"items": {
										"$ref": "#/components/schemas/Workbook"
									}
								}
							}
						}
                    },
                    "default": {
                        "description": "unexpected error",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/ErrorResponse"
                                }
                            }
                        }
                    }
				}
			}
		}
    },
    "components": {
        "schemas": {
            "ErrorResponse": {
                "required": [
                    "message"
                ],
                "properties": {
                    "message": {
                        "type": "string"
                    }
                }
            },
            "Feather": {
                "description": "Feather definition",
                "type": "object",
                "properties": {
                    "id": {
                        "description": "Unique identifier",
                        "type": "string"
                    },
                    "name": {
                        "description": "Feather name",
                        "type": "string"
                    },
                    "description": {
                        "description": "Feather description",
                        "type": "string"
                    },
                    "plural": {
                        "description": "Plural",
                        "type": "string"
                    },
                    "module": {
                        "description": "Module",
                        "type": "string"
                    },
                    "authorization": {
                        "description": "Module",
                        "type": "object"
                    },
                    "inherits": {
                        "description": "Inherits",
                        "type": "string",
                        "default": "Object"
                    },
                    "isSystem": {
                        "description": "System flag",
                        "type": "boolean",
                        "default": false
                    },
                    "isChild": {
                        "description": "Indicates feather always a child of another record",
                        "type": "boolean",
                        "default": false
                    }, 
                    "overloads": {
                        "description": "Property overloads",
                        "type": "object"
                    },
                    "isFetchOnStartup": {
                        "description": "Load all records of this type into the catalog",
                        "type": "boolean",
                        "default": false
                    },
                    "isReadOnly": {
                        "description": "Record can not be edited by the client ",
                        "type": "boolean",
                        "default": false
                    },
                    "properties": {
                        "description": "Properties or columns of the feather",
                        "type": "array",
                        "items": {
                            "$ref": "#/components/schemas/FeatherProperty"
                        }
                    }
                }
            },
            "FeatherProperty": {
                "description": "Feather property definition",
                "type": "object",
                "properties": {
                    "name": {
                        "description": "Name",
                        "type": "string"
                    },
                    "description": {
                        "description": "Description",
                        "type": "string"
                    },
                    "alias": {
                        "description": "Alternate name for property",
                        "type": "string"
                    },
                    "type": {
                        "description": "Type",
                        "type": "object"
                    },
                    "format": {
                        "description": "Data format",
                        "type": "string"
                    },
                    "scale": {
                        "description": "Numeric scale",
                        "type": "number",
                        "default": -1
                    },
                    "precision": {
                        "description": "Numeric precision",
                        "type": "number",
                        "default": -1
                    },
                    "min": {
                        "description": "Numeric minimum",
                        "type": "number"
                    },
                    "max": {
                        "description": "Numeric maximum",
                        "type": "number"
                    },
                    "default": {
                        "description": "Default",
                        "type": "object"
                    },
                    "autonumber": {
                        "description": "Type",
                        "type": "object"
                    },
                    "isReadOnly": {
                        "description": "Ready only flag",
                        "type": "boolean",
                        "default": false
                    },
                    "isRequired": {
                        "description": "Required flag",
                        "type": "boolean",
                        "default": false
                    },
                    "isUnique": {
                        "description": "Unique flag",
                        "type": "boolean",
                        "default": false
                    },
                    "inheritedFrom": {
                        "description": "Inherited source table",
                        "type": "string"
                    },
                    "dataList": {
                        "description": "Array of input values",
                        "type": "string"
                    },
                    "isIndexed": {
                        "description": "Flag whether to index property",
                        "type": "boolean",
                        "default": false
                    }
                }
            },
            "Module": {
                "description": "Generic definition for module",
                "properties": {
                    "name": {
                        "description": "Module name",
                        "type": "string"
                    },
                    "script": {
                        "description": "Client side javascript",
                        "type": "string"
                    },
                    "version": {
                        "description": "Module version",
                        "type": "string"
                    },
                    "dependencies": {
                        "description": "Module dependencies",
                        "type": "object"
                    },
                    "isActive": {
                        "description": "Active flag",
                        "type": "boolean"
                    }
                }
            },
            "Settings": {
                "description": "Generic definition for settings",
                "properties": {
                    "id": {
                        "description": "Unique identifier",
                        "type": "string"
                    },
                    "etag": {
                        "description": "Version for pessemistic locking",
                        "type": "string"
                    },
                    "data": {
                        "description": "Settings data",
                        "type": "object"
                    }
                }
            },
            "Workbook": {
                "description": "Generic definition for workbook",
                "properties": {
                    "name": {
                        "description": "Workbook name",
                        "type": "string"
                    },
                    "description": {
                        "description": "Description",
                        "type": "string"
                    },
                    "module": {
                        "description": "Module reference",
                        "type": "string"
                    },
                    "launchConfig": {
                        "description": "Workbook menu configuration",
                        "type": "object"
                    },
                    "defaultConfig": {
                        "description": "Default workbook page configuration",
                        "type": "object"
                    },
                    "localConfig": {
                        "description": "Workbook configuration altered and shared by users",
                        "type": "object"
                    }
                }
            }
        }
    }
}