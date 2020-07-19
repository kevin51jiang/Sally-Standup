const http = require('http');
const express = require('express');
const { createMessageAdapter } = require('@slack/interactive-messages');
const { WebClient } = require('@slack/web-api');
const { users, neighborhoods } = require('./models');
const axios = require('axios');
const bodyParser = require('body-parser');
var JsonDB = require('node-json-db').JsonDB
var Config = require('node-json-db/dist/lib/JsonDBConfig').Config;
const fuse = require('fuse.js')



const db = new JsonDB(new Config('todoDB', true, true, '/'))

// Read the signing secret and access token from the environment variables
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackAccessToken = process.env.SLACK_ACCESS_TOKEN;
if (!slackSigningSecret || !slackAccessToken) {
  throw new Error('A Slack signing secret and access token are required to run this app.');
}

// Create the adapter using the app's signing secret
const slackInteractions = createMessageAdapter(slackSigningSecret);

// Create a Slack Web API client using the access token
const web = new WebClient(slackAccessToken);

// Initialize an Express application
const app = express();

// Attach the adapter to the Express application as a middleware
app.use('/slack/actions', slackInteractions.expressMiddleware());

// Attach the slash command handler
app.post('/slack/commands', bodyParser.urlencoded({ extended: false }), slackSlashCommand);

// Start the express application server
const port = process.env.PORT || 3000;
http.createServer(app).listen(port, () => {
  console.log(`server listening on port ${port}`);
});

// Slack interactive message handlersd
slackInteractions.action('accept_tos', (payload, respond) => {
  console.log(`The user ${payload.user.name} in team ${payload.team.domain} pressed a button`);

  // Use the data model to persist the action
  users.findBySlackId(payload.user.id)
    .then(user => user.setPolicyAgreementAndSave(payload.actions[0].value === 'accept'))
    .then((user) => {
      // After the asynchronous work is done, call `respond()` with a message object to update the
      // message.
      let confirmation;
      if (user.agreedToPolicy) {
        confirmation = 'Thank you for agreeing to the terms of service';
      } else {
        confirmation = 'You have denied the terms of service. You will no longer have access to this app.';
      }
      respond({ text: confirmation });
    })
    .catch((error) => {
      // Handle errors
      console.error(error);
      respond({
        text: 'An error occurred while recording your agreement choice.'
      });
    });

  // Before the work completes, return a message object that is the same as the original but with
  // the interactive elements removed.
  const reply = payload.original_message;
  delete reply.attachments[0].actions;
  return reply;
});

slackInteractions
  .options({ callbackId: 'pick_sf_neighborhood', within: 'interactive_message' }, (payload) => {
    console.log(`The user ${payload.user.name} in team ${payload.team.domain} has requested options`);

    // Gather possible completions using the user's input
    return neighborhoods.fuzzyFind(payload.value)
      // Format the data as a list of options
      .then(formatNeighborhoodsAsOptions)
      .catch((error) => {
        console.error(error);
        return { options: [] };
      });
  })
  .action('pick_sf_neighborhood', (payload, respond) => {
    console.log(`The user ${payload.user.name} in team ${payload.team.domain} selected from a menu`);

    // Use the data model to persist the action
    neighborhoods.find(payload.actions[0].selected_options[0].value)
      // After the asynchronous work is done, call `respond()` with a message object to update the
      // message.
      .then((neighborhood) => {
        respond({
          text: payload.original_message.text,
          attachments: [{
            title: neighborhood.name,
            title_link: neighborhood.link,
            text: 'One of the most interesting neighborhoods in the city.',
          }],
        });
      })
      .catch((error) => {
        // Handle errors
        console.error(error);
        respond({
          text: 'An error occurred while finding the neighborhood.'
        });
      });

    // Before the work completes, return a message object that is the same as the original but with
    // the interactive elements removed.
    const reply = payload.original_message;
    delete reply.attachments[0].actions;
    return reply;
  });

slackInteractions.action({ type: 'dialog_submission' }, (payload, respond) => {
  // `payload` is an object that describes the interaction
  console.log(`The user ${payload.user.name} in team ${payload.team.domain} submitted a dialog`);

  // Check the values in `payload.submission` and report any possible errors
  const errors = validateKudosSubmission(payload.submission);
  if (errors) {
    return errors;
  } else {
    setTimeout(() => {
      const partialMessage = `<@${payload.user.id}> just gave kudos to <@${payload.submission.user}>.`;

      // When there are no errors, after this function returns, send an acknowledgement to the user
      respond({
        text: partialMessage,
      });

      // The app does some work using information in the submission
      users.findBySlackId(payload.submission.id)
        .then(user => user.incrementKudosAndSave(payload.submission.comment))
        .then((user) => {
          // After the asynchronous work is done, call `respond()` with a message object to update
          // the message.
          respond({
            text: `${partialMessage} That makes a total of ${user.kudosCount}! :balloon:`,
            replace_original: true,
          });
        })
        .catch((error) => {
          // Handle errors
          console.error(error);
          respond({ text: 'An error occurred while incrementing kudos.' });
        });
    });
  }
});


// Example interactive messages
const interactiveButtons = {
  text: 'The terms of service for this app are _not really_ here: <https://unsplash.com/photos/bmmcfZqSjBU>',
  response_type: 'in_channel',
  attachments: [{
    text: 'Do you accept the terms of service?',
    callback_id: 'accept_tos',
    actions: [
      {
        name: 'accept_tos',
        text: 'Yes',
        value: 'accept',
        type: 'button',
        style: 'primary',
      },
      {
        name: 'accept_tos',
        text: 'No',
        value: 'deny',
        type: 'button',
        style: 'danger',
      },
    ],
  }],
};

const pick_sf_neighborhood = {
  text: 'San Francisco is a diverse city with many different neighborhoods.',
  response_type: 'in_channel',
  attachments: [{
    text: 'Explore San Francisco',
    callback_id: 'pick_sf_neighborhood',
    actions: [{
      name: 'neighborhood',
      text: 'Choose a neighborhood',
      type: 'select',
      data_source: 'external',
    }],
  }],
};

const dialog = {
  callback_id: 'kudos_submit',
  title: 'Give kudos',
  submit_label: 'Give',
  elements: [
    {
      label: 'Teammate',
      type: 'select',
      name: 'user',
      data_source: 'users',
      placeholder: 'Teammate Name'
    },
    {
      label: 'Comment',
      type: 'text',
      name: 'comment',
      placeholder: 'Thanks for helping me with my project!',
      hint: 'Describe why you think your teammate deserves kudos.',
    },
  ],
};

// Slack slash command handler
function slackSlashCommand(req, res, next) {
  if (req.body.command === '/sally') {
    const type = req.body.text.split(' ')[0];
    console.log('Got request: ', req.body.text)
    if (type === 'add' || type === 'create') {
      // CREATE NEW TODO
      const response = addAttrib(req.body, 'todo')
      res.json(response);
    } else if (type === 'finish' || type === 'fin' || type === 'done') {
      // END NEW TODO
      const response = finishTodo(req.body);
      res.json(response);
    } else if (type === 'standup') {
      // SEND STANDUP
      const response = standup(req.body)
      res.json(response);
    } else if (type === 'list' || type === 'display') {
      // LIST CURRENT TASKS
      res.send();
    } else if (type === 'blocker') {
      // ADD BLOCKER
      const response = addAttrib(req.body, 'blocker', true)
      res.json(response);
    } else if (type === 'clear') {
      // CLEAR ALL TODOS
      const response = clearTodos(req.body.user_id)
      res.json(response);
    } else {
      // Help
      res.send('Use this command followed by `add <string>`, `finish <string>`, or `standup`.');
    }
  } else {
    next();
  }
}


const addAttrib = (body, attrib, inChannel = false) => {
  try {

    const text = body.text;
    const newTodo = text.substr(text.indexOf(" ") + 1);
    db.push(`/${body.user_id}/${attrib}[]`, newTodo, false);

    const message = {
      text: `<@${body.user_id}>, ${attrib} _"${newTodo}"_ has been added successfully.`,
    }
    if (inChannel) {
      message.response_type = 'in_channel'
    }
  } catch (error) {
    return {
      text: `<@${body.user_id}>, your ${attrib} has NOT been added. Please try again.`,
    }
  }
}

/**
 * Displays what's done, what to do today (will carryover from previous days), and scheduled meeting time
 * Then, will clear what's done
 */
const standup = (body) => {
  try {
    const categories = ['todo', 'finished', 'blocker']
    const userId = body.user_id;
    const now = new Date();

    let returnable = {
      text: `<@${userId}>'s standup for ${now.toDateString()}`,
      response_type: 'in_channel'
    };

    returnable.blocks = getBlockFrom(userId, 'todo')

    return returnable;
  } catch (err) {
    console.log(err);
    return {
      text: `<@${body.user_id}>, your standup has failed due to ${err}. Please try again.`,
    }
  }
}

const getBlockFrom = (userId, attrib) => {
  const bullet = '•';
  let numberOfElement = db.count(`/${userId}/${attrib}`);
  console.log('numberOfElement', numberOfElement)

  const returnable = {
    type: 'section',
    'text': {
      text: [...Array(numberOfElement)].reduce((acc, _, i) => {
        return acc + (bullet + db.getData(`/${userId}/${attrib}[${i}]`) + '\n').toString()
      }, ''),
      type: 'plain'
    }
  }
  console.log('returnable', returnable)
  return returnable
}

const display = (userId) => {
  try {

  } catch (err) {
    return {
      text: `<@${userId}>, your standup has failed due to ${err}. Please try again.`,
    }
  }
}

const finishTodo = (body) => {
  try {

  } catch (err) {
    return {
      text: `<@${body.user_id}>, your standup has failed due to ${err}. Please try again.`,
    }
  }
}

const clearTodos = (userId) => {
  try {
    db.delete(`${userId}/`)

    return {
      text: `<@${userId}>, your standup has been successfully cleared!`,
      response_type: 'in_channel',
    }
  } catch (err) {
    return {
      text: `<@${userId}>, your standup has NOT been cleared, due to ${err}. Please try again.`,
    }
  }
}

const getTodoOpts = (userId) => {
  const unfinished = db.getData(`${userId}/todos`)

  return unfinished.map((todo) => {
    return {
      text: todo,
      value: todo
    }
  })
}

// Helpers
function validateKudosSubmission(submission) {
  let errors = [];
  if (!submission.comment.trim()) {
    errors.push({
      name: 'comment',
      error: 'The comment cannot be empty',
    });
  }
  if (errors.length > 0) {
    return { errors };
  }
}
