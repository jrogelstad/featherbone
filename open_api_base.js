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
		"url": "localhost:10001"
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
                "description": "Generic definition for Feather",
                "properties": {
                    "value": {
                        "description": "Surrogate key",
                        "type": "object"
                    }
                }
            },
            "Settings": {
                "description": "Generic definition for settings",
                "properties": {
                    "value": {
                        "description": "Surrogate key",
                        "type": "object"
                    }
                }
            },
            "Workbook": {
                "description": "Generic definition for workbook",
                "properties": {
                    "value": {
                        "description": "Surrogate key",
                        "type": "object"
                    }
                }
            }
        }
    }
}