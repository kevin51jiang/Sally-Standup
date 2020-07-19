const http = require("http");
const express = require("express");
const { createMessageAdapter } = require("@slack/interactive-messages");
const { WebClient } = require("@slack/web-api");
const { users, neighborhoods } = require("./models");
const axios = require("axios");
const bodyParser = require("body-parser");
var JsonDB = require("node-json-db").JsonDB;
var Config = require("node-json-db/dist/lib/JsonDBConfig").Config;
const utils = require("./utils");
const dict = require("./dict");
const db = new JsonDB(new Config("todoDB", true, true, "/"));

// Read the signing secret and access token from the environment variables
const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const slackAccessToken = process.env.SLACK_ACCESS_TOKEN;
if (!slackSigningSecret || !slackAccessToken) {
  throw new Error(
    "A Slack signing secret and access token are required to run this app."
  );
}
/////////////////////////////
// SELF DEFINED CONSTANTS //
////////////////////////////
const categories = ["todo", "finished", "blocker"];

const slackInteractions = createMessageAdapter(slackSigningSecret);
const web = new WebClient(slackAccessToken);

// Initialize an Express application
const app = express();

// Attach the adapter to the Express application as a middleware
app.use("/slack/actions", slackInteractions.expressMiddleware());

// Attach the slash command handler
app.post(
  "/slack/commands",
  bodyParser.urlencoded({
    extended: false,
  }),
  slackSlashCommand
);

// Start the express application server
const port = process.env.PORT || 3000;
http.createServer(app).listen(port, () => {
  console.log(`server listening on port ${port}`);
});

// Example of handling static select (a type of block action)
slackInteractions.action(
  {
    type: "static_select",
  },
  (payload, respond) => {
    try {
      const userId = payload.user.id;
      const selectedOpt = payload.actions[0].selected_option.value;

      let numberOfElement = db.count(`/${userId}/${dict.stages.todo.path}`);
      console.log("numberOfElement", numberOfElement);

      const status = [...Array(numberOfElement)].forEach((_, i) => {
        const todoAt = db.getData(
          `/${userId}/${dict.stages.todo.path}[${[i]}]`
        );
        console.log("comparing ", todoAt, selectedOpt);
        if (todoAt === selectedOpt) {
          //create first, then delete
          db.push(
            `/${userId}/${dict.stages.finished.path}[]`,
            selectedOpt,
            true
          );
          db.delete(`/${userId}/${dict.stages.todo.path}[${i}]`); // delete second
          respond({
            text: `_"${selectedOpt}"_ has been moved to the finished list.`,
          });
        }
      });
    } catch (err) {
      respond({
        text: `Sorry, that action could not be done. Please try again later. Err: ${err}`,
      });
    }
  }
);

/**
 * Cancel button
 */
slackInteractions.action({ action_id: "cancel_remove" }, (payload, respond) => {
  respond({ text: "Cancelled." });
});

const pickTaskToFinish = {
  attachments: [
    {
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Pick a finished item from the dropdown list",
          },
          accessory: {
            type: "static_select",
            placeholder: {
              type: "plain_text",
              text: "Select an todo",
              emoji: true,
            },
            action_id: "submit-del-choice",
            confirm: {
              title: {
                type: "plain_text",
                text: "Mark as finished",
              },
              text: {
                type: "plain_text",
                text: "Are you sure you want to mark this item as finished?",
              },
              confirm: {
                type: "plain_text",
                text: "Yes",
              },
              deny: {
                type: "plain_text",
                text: "No",
              },
            },
            // OPTIONS HERE
            options: [
              {
                text: {
                  type: "plain_text",
                  text: "*this is plain_text text*",
                  emoji: true,
                },
                value: "value-0",
              },
            ],
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Cancel",
                emoji: true,
              },
              action_id: "cancel-remove",
              style: "danger",
            },
          ],
        },
      ],
    },
  ],
};

// Slack slash command handler
function slackSlashCommand(req, res, next) {
  if (req.body.command === "/sally") {
    const type = req.body.text.split(" ")[0];
    console.log("Got request: ", req.body.text);
    let response;
    if (type === "add" || type === "create") {
      // CREATE NEW TODO
      response = addAttrib(req.body, "todo");
    } else if (type === "finish" || type === "fin" || type === "done") {
      // END NEW TODO
      const todoOpts = getTodoOpts(req.body.user_id);
      let response = {
        ...pickTaskToFinish,
      };
      response.attachments[0].blocks[0].accessory.options = todoOpts.fields;
    } else if (type === "standup") {
      // SEND STANDUP
      response = standup(req.body);
      //clean up finished and blockers
      db.delete(`/${req.body.user_id}/finished`);
      db.delete(`/${req.body.user_id}/blocker`);
    } else if (type === "list" || type === "display") {
      // LIST CURRENT TASKS
      response = display(req.body.user_id);
    } else if (type === "blocker") {
      // ADD BLOCKER
      response = addAttrib(req.body, "blocker", true);
    } else if (type === "clear") {
      // CLEAR ALL TODOS
      response = clearTodos(req.body.user_id);
    } else {
      // Help
      res.send(
        "Use this command followed by `add <string>`, `blocker`, or `finish` to move tasks around. Use `list` or `standup` to view the current status. Note: `standup` removes finished tasks."
      );
    }
    res.json(response);
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
    };
    if (inChannel) {
      message.response_type = "in_channel";
    }

    return message;
  } catch (error) {
    return {
      text: `<@${body.user_id}>, your ${attrib} has NOT been added. Please try again.`,
    };
  }
};

/**
 * Displays what's done, what to do today (will carryover from previous days), and scheduled meeting time
 * Then, will clear what's done
 */
const standup = (body) => {
  try {
    const userId = body.user_id;
    const now = new Date();
    const title = {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<@${userId}>'s standup for ${now.toDateString()}*`,
      },
    };

    const standupResults = display(userId);
    standupResults[0] = title; // update title for daily standup

    return standupResults;
  } catch (err) {
    console.log(err);
    return {
      text: `<@${body.user_id}>, your standup has failed due to ${err}. Please try again.`,
    };
  }
};

const getBlockFrom = (userId, attrib) => {
  // const bullet = "•";
  let numberOfElement = db.count(`/${userId}/${attrib}`);

  const returnable = {
    type: "section",
    fields: [...Array(numberOfElement)].map((_, i) => {
      return {
        type: "mrkdwn",
        text: db.getData(`/${userId}/${attrib}[${i}]`),
      };
    }),
  };
  return returnable;
};

const display = (userId) => {
  try {
    const now = new Date();
    const divider = {
      type: "divider",
    };

    let blocks = [];
    const title = {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*<@${userId}>'s current status for ${now.toDateString()}*`,
      },
    };

    blocks.push(title);

    blocks = categories.reduce((acc, category) => {
      let catBlock;
      const catTitle = {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${dict.stages[category].disp}*`,
        },
      };

      try {
        catBlock = getBlockFrom(userId, category);

        if (category === dict.stages.finished.path) {
          catBlock.fields = catBlock.fields.map((field) => {
            return {
              ...field,
              text: `~${field.text}~`,
            };
          });
        }
      } catch (err) {
        catBlock = {
          type: "section",
          fields: [
            {
              type: "plain_text",
              text: "Empty!",
            },
          ],
        };
      }

      acc.push(catTitle, catBlock, divider);
      return acc;
    }, blocks);

    let displayResults = {
      response_type: "in_channel",
      blocks: blocks,
    };

    return displayResults;
  } catch (err) {
    return {
      text: `<@${userId}>, your standup has failed due to ${err}. Please try again.`,
    };
  }
};

const clearTodos = (userId) => {
  try {
    db.delete(`${userId}/`);

    return {
      text: `<@${userId}>, your standup has been successfully cleared!`,
      response_type: "in_channel",
    };
  } catch (err) {
    return {
      text: `<@${userId}>, your standup has NOT been cleared, due to ${err}. Please try again.`,
    };
  }
};

const getTodoOpts = (userId) => {
  let numberOfElement = db.count(`/${userId}/${dict.stages.todo.path}`);

  const returnable = {
    fields: [...Array(numberOfElement)].map((_, i) => {
      const todo = db.getData(`/${userId}/${dict.stages.todo.path}[${i}]`);
      return {
        text: {
          type: "mrkdwn",
          text: todo,
          emoji: true,
        },
        value: todo,
      };
    }),
  };

  return returnable;
};
