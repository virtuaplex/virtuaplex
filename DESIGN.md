Below is a design document for an open source project that I want to create. Based on this information, please create a design for the web API for creating and organizing a theater as well as the database schema. The API should have robust scheduling features and the ability to add magnet links and metadata for films

# Virtuaplex

Virtuaplex is a virtual movie going experience. It is a Roblox-style "game" on the web that consists of being in a movie theatre, going to a theatre and watching a movie along with other moviegoers. There will be multiple theatres but every player in the same theatre will be watching the same movie at the same time. WebTorrent will be utilized to deliver the movies so that people watching the movies in the same theatre are sharing it between each other. This will be an open source project where everything will be free.

Anybody can host a game server and there will be a flagship community-run instance at virtuaplex.net. The community-run instance will host theatres only showing content from the public domain. At no point will the project ever endorse copyright infringement or unauthorized sharing of media. However, it is possible that other servers may emerge that are not able to or willing to monitor their server for copyright infringement. This situation is simply part of the risks of creating open source software and is outside the scope of this project.

## Components:

### Web server

Written in Golang that has several functions:
- Provides a web interface for users to create and edit theatres (meaning scheduling movies and providing the magnet links / metadata)
- Implements the API to create and edit theatres
- Serve the game itself to anyone on the front page

### Game

The game will be a 3D style game with simple graphics similar to Robolox or Minecraft. The player can walk around in the world and explore the inside of the movie theatre and visit diffent rooms. In in actual theatre room, the player can choose a seat (that is not currently occupied) and sit down. Once seated, the player mainly just watches the movie but they can see other players, either seated around them or walking to / from their seats.

There will be a chat system on the top left of the screen that can be hidden. Each theatre will have one more "lobbies". Each lobby can support a fixed number of players based on the available seating in the theatre (maybe like 50 people). If more than 50 people want to visit the same theatre, a new lobby will automatically be created



## Minimum Viable Product

An MVP will not contain the game experience and will be focused on building the web server / theatre editing capabilities and database stuff. For simplicity the DB will be a SQLite file and the server will be a single executable file writen in Go.

To test the WebTorrent stuff, instead of a game, a simple HTML will also be provided that simply shows one of the films and has some statistics displayed such as number of people in the lobby and maybe a chat.



## In-game Ideas for Rooms
- A theatre can be marked by its operator as "VPN Recommended". This could make it so that when you spawn outside the theatre and you are not using a VPM, the door will be locked but there will be a side entrance for users to sneak into anyway
- A server room that displays technical information (torrent info, versions etc)
