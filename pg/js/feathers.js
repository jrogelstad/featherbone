/**
    Featherbone is a JavaScript based persistence framework for building object relational database applications
    
    Copyright (C) 2015  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

DO $$
   plv8.execute('SELECT init()');

   /* Create some foundation classes */
   featherbone.request({
     action: "POST",
     name: "saveFeather",
     user: user,
     data: [[{
       name: "Role", 
       description: "User authorization role",
       authorization: false,
       properties: {
         name: {
             description: "Name",
             type: "string"
         },
         description: {
             description: "Description",
             type: "string"
         }
       }
     },{
       name: "RoleMember", 
       description: "Member reference to a parent role",
       authorization: false,
       properties: {
         parent: {
             description: "Parent role",
             type: {
               relation: "Role",
               childOf: "members"
             }
         },
         member: {
             description: "member",
             type: "string"
         }
       }
     },{
       name: "Folder", 
       description: "Container of parent objects",
       authorization: false,
       properties: {
         owner: {
             description: "Owner of the document",
             type: "string",
             defaultValue: "getCurrentUser()"
         },
         name: {
             description: "Name",
             type: "string"
         },
         description: {
             description: "Description",
             type: "string"
         }
       }
     },{
       name: "Document",
       description: "Base document class",
       authorization: false,
       properties: {
         owner: {
             description: "Owner of the document",
             type: "string",
             defaultValue: "getCurrentUser()"
         },
         etag: {
             description: "Optimistic locking key",
             type: "string",
             defaultValue: "createId()"
         }
       }
     },{
       name: "Log", 
       description: "Feather for logging all schema and data changes",
       authorization: false,
       properties: {
         objectId: {
             description: "Object change was performed against",
             type: "string"
         },
         action: {
             description: "Action performed",
             type: "string"
         },
         change: {
             description: "Patch formatted json indicating changes",
             type: "object"
         }
       }
     }
   ]]}, true);

   /* Create default global folder */
   global = featherbone.request({
     name: "Folder",
     action: "GET",
     user: user,
     id: "global"
   }, true);

   if (!Object.keys(global).length) {
     featherbone.request({
       name: "Folder",
       action: "POST",
       user: user,
       folder: false,
       data: {
         id: "global",
         name: "Global folder",
         description: "Root folder for all objects"
       }
     }, true)
   }

   /* Create Everyone role */
   role = featherbone.request({
     name: "Role",
     action: "GET",
     user: user,
     id: "everyone"
   }, true);

   if (!Object.keys(role).length) {
     featherbone.request({
       name: "Role",
       action: "POST",
       user: user,
       folder: "global",
       data: {
         id: "everyone",
         name: "Everyone",
         description: "All users",
         members: [
           {member: user}
         ]
       }
     }, true);

     /* Grant everyone access to global folder */
     req = {
       action: "POST",
       name: "saveAuthorization",
       user: user,
       data: {
         id: "global",
         role: "everyone",
         isMember: true,
         actions: {
           canCreate: true,
           canRead: true,
           canUpdate: true,
           canDelete: true
         }
       }
     };

     /* Access to folder contents */
     featherbone.request(req);

     /* Access to folder itself */
     delete req.data.isMember;
     featherbone.request(req);

     /* Grant everyone access to other objects */
     req.data.id = "role";
     featherbone.request(req);
     req.data.id = "folder";
     featherbone.request(req);
     req.data.id = "log"
     featherbone.request(req);
   }

$$ LANGUAGE plv8;
