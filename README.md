# Sally Standup [![Devpost | Sally Standup](https://badges.devpost-shields.com/get-badge?name=Sally%20Standup&id=sally-standup&type=custom-color&style=for-the-badge)](https://devpost.com/software/sally-standup)
> Daily standups - without the memory leaks.

![Sample usage](https://challengepost-s3-challengepost.netdna-ssl.com/photos/production/software_photos/001/157/707/datas/gallery.jpg)

## Inspiration
I've realized that way too much of my time at work is dedicated to just remembering what I did yesterday, only to forget and spend 5 minutes scrolling up until I see the standup I did yesterday and  copy it word for word.

Sally Standup solves this problem by having a place where you can send tasks that you've done, or stuff that you need to do.

Then, when it's time for your standup, all you need is a quick `/sally standup` that shows what you've done yesterday, all presented in a clear manner.


## How to use

### Installation 

`git clone` then `npm install`. After that fill out your own .env using the template provided in `.env.sample`. Then, use `npm start` to start the program.

### Commands

`sally standup`: Displays your current todos/done/blockers, then deletes your completed and blockers.

`sally add <string>`: Use it anytime, anywhere. Whenever you get assigned a new item, wheever a meeting happens, it doesn't matter. One quick line will add a todo to the bot. 

`sally finish`: Choose to send one f your predefined messages and move it to the finished list.

`sally blocker <string>`: Adds a blocker to the list

`sally list`: View the current status of all your lists

`sally clear`: Clears all your records.

## How I built it

NodeJS and the [Slack SDK](https://github.com/slackapi/node-slack-sdk/) were a great help.

Persistence built in by `node-json-db`.

## Challenges I ran into

Setting up the slack environment was challenging, requiring ngrok even for local development.  Many small errors were made with the structure for the interactive elements for Slack as well, sucking up a lot of time.

## Accomplishments that I'm proud of
Assuming it saves 2 minutes/person/day, at a company at around 500 employees,
This gives 1000min saved/day.

In 2020, there are 252 working days, meaning that it saves 4200 hours/year.

Assuming pay of $25/hr, this saves $105 000/year! In other words,  a *lot* of turnips.

Also - since it's on Slack, I guess you can call this responsive design?

## What I learned

First time I've made a NodeJS application without being destroyed by race conditions/promises/etc. Yay!

## What's next for Sally Standup

Integrations! Especially Outlook Calendar for having a line for saying `[x] hours of meetings scheduled today`. However, had some problems with signing up for MS auth so will hopefully fix that soon.
