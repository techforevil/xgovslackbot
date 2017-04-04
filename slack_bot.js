
if (!process.env.token) {
    console.log('Error: Specify token in environment');
    process.exit(1);
}

var botkitStoragePostgres = require('botkit-storage-postgres');
var Botkit = require('botkit');
var os = require('os');
var request = require('request');
var cfenv = require("cfenv");
var appEnv = cfenv.getAppEnv();
if (appEnv.isLocal) {
  var controller = Botkit.slackbot({
      debug: true,
      storage: botkitStoragePostgres({
        host: "localhost",
        user: "xgovslackbot",
        password: "xgovslackbot",
        database: "xgovslackbot"
      })
  });
} else {
  var pgEnv = appEnv.getServices();
  var controller = Botkit.slackbot({
      debug: true,
      storage: botkitStoragePostgres({
        host: pgEnv["my-pg-service"]["credentials"]["host"],
        user: pgEnv["my-pg-service"]["credentials"]["username"],
        password: pgEnv["my-pg-service"]["credentials"]["password"],
        database: pgEnv["my-pg-service"]["credentials"]["database"]
      })
  });
}

var bot = controller.spawn({
    token: process.env.token
}).startRTM();

controller.hears(['^hello', '^hi'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: 'robot_face',
    }, function(err, res) {
        if (err) {
            bot.botkit.log('Failed to add emoji reaction :(', err);
        }
    });


    controller.storage.users.get(message.user, function(err, user) {
        if (user && user.name) {
            bot.reply(message, 'Hello ' + user.name + '!!');
        } else {
            bot.reply(message, 'Hello '+message.user);
        }
    });
});

controller.hears(['call me (.*)', 'my name is (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var name = message.match[1];
    controller.storage.users.get(message.user, function(err, user) {
        if (!user) {
            user = {
                id: message.user,
            };
        }
        user.name = name;
        controller.storage.users.save(user, function(err, id) {
            bot.reply(message, 'Got it. I will call you ' + user.name + ' from now on.');
        });
    });
});

controller.hears(['what is my name', 'who am i'], 'direct_message,direct_mention,mention', function(bot, message) {

    controller.storage.users.get(message.user, function(err, user) {
        if (user && user.name) {
            bot.reply(message, 'Your name is ' + user.name);
        } else {
            bot.startConversation(message, function(err, convo) {
                if (!err) {
                    convo.say('I do not know your name yet!');
                    convo.ask('What should I call you?', function(response, convo) {
                        convo.ask('You want me to call you `' + response.text + '`?', [
                            {
                                pattern: 'yes',
                                callback: function(response, convo) {
                                    // since no further messages are queued after this,
                                    // the conversation will end naturally with status == 'completed'
                                    convo.next();
                                }
                            },
                            {
                                pattern: 'no',
                                callback: function(response, convo) {
                                    // stop the conversation. this will cause it to end with status == 'stopped'
                                    convo.stop();
                                }
                            },
                            {
                                default: true,
                                callback: function(response, convo) {
                                    convo.repeat();
                                    convo.next();
                                }
                            }
                        ]);

                        convo.next();

                    }, {'key': 'nickname'}); // store the results in a field called nickname

                    convo.on('end', function(convo) {
                        if (convo.status == 'completed') {
                            bot.reply(message, 'OK! I will update my dossier...');

                            controller.storage.users.get(message.user, function(err, user) {
                                if (!user) {
                                    user = {
                                        id: message.user,
                                    };
                                }
                                user.name = convo.extractResponse('nickname');
                                controller.storage.users.save(user, function(err, id) {
                                    bot.reply(message, 'Got it. I will call you ' + user.name + ' from now on.');
                                });
                            });



                        } else {
                            // this happens if the conversation ended prematurely for some reason
                            bot.reply(message, 'OK, nevermind!');
                        }
                    });
                }
            });
        }
    });
});

controller.hears(['announce (.*)'],
  'direct_mention', function(bot, message) {
    /* Currently in channel, and only the #bot-test channel */
    var channel = message.channel;
    var msgtext = message.match[1];
    var user = message.user
    if (channel === "C4UCWCMA6") {
      request.post({
            url: 'https://ukgovernmentdigital.slack.com/api/chat.postMessage',
            form: {
              channel: channel,
              token: process.env.apitoken,
              username: "thegovernor",
              as_user: false,
              text: "<!channel> "+msgtext+" (via <@"+user+">)"
            }
          });
      bot.reply(message, "done");
    } else {
      bot.reply(message, "Only for the #bot-test channel for now");
    }
  }
)


controller.hears(['^invite.*\\|(.*)>'],
  'direct_message, direct_mention', function(bot, message) {
    controller.log("Got an invite for email: "+message.match[1]);
    request.post({
          url: 'https://ukgovernmentdigital.slack.com/api/users.admin.invite',
          form: {
            email: message.match[1],
            token: process.env.apitoken,
            set_active: true
          }
        }, function(err, httpResponse, body) {
          // body looks like:
          //   {"ok":true}
          //       or
          //   {"ok":false,"error":"already_invited"}
          if (err) { return res.send('Error:' + err); }
          body = JSON.parse(body);
          if (body.ok) {
            bot.reply(message, "Invite sent, tell them to check their email");
          } else {
            if (body.error === "invalid_email") {
              bot.reply(message, "The email is not valid.  Email: "+message.match[1]);
            }
            else if (body.error === "invalid_auth") {
              bot.reply(message, "The Governor doesn't have the rights to do that");
            } else {
              bot.reply(message, "The Governor got error: "+body.error);
            }
          }
        });
  });

controller.hears(['uptime', 'identify yourself', 'who are you', 'what is your name'],
    'direct_message,direct_mention,mention', function(bot, message) {

        var hostname = os.hostname();
        var uptime = formatUptime(process.uptime());

        bot.reply(message,
            ':robot_face: I am a bot named <@' + bot.identity.name +
             '>. I have been running for ' + uptime + ' on ' + hostname + '.');

    });

function formatUptime(uptime) {
    var unit = 'second';
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'minute';
    }
    if (uptime > 60) {
        uptime = uptime / 60;
        unit = 'hour';
    }
    if (uptime != 1) {
        unit = unit + 's';
    }

    uptime = uptime + ' ' + unit;
    return uptime;
}