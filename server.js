var express = require('express');
var request = require('request');
var redis = require('./redis');
var server = express();
var _ = require('lodash');

server.use(express.static(__dirname + '/public'));

server.get('/api/users/:username/following', function(req, res) {
    following(req.params.username, function(error, following) {
        if (error) {
            res.status(400).send({error: 'Something went wrong'});
        } else {
            res.send(following);
        }
    });
});


server.listen(process.env.PORT || 3141);

var github = function (url, callback) {
    redis.get('github:' + url, function (error, data) {
        if (data) {
            data = JSON.parse(data);
            callback(data.error, data.response, data.body);
        } else {
            request({
                url: url,
                headers: {
                    'User-Agent': 'alexander.gugel@gmail.com',
                    'Accept': 'application/vnd.github.v3.star+json'
                },
                auth: {
                    user: process.env.PERSONAL_ACCESS_TOKEN || 'b330b9717358384e84f4e5d2bc7394d241738e0e'
                }
            }, function(error, response, body) {
                body = JSON.parse(body);
                redis.set('github:' + url, JSON.stringify({
                    error: error,
                    response: response,
                    body: body
                }));
                redis.expire('github:' + url, 60*60*24*14); // cache for 2 weeks
                callback(error, response, body);
            });
        }
    });
};

var user = function(username, callback) {
    github('https://api.github.com/users/' + username, function(error, response, body) {
        if (error) return callback(error);
        callback(null, body);
    });
};

var following = function(username, callback) {
    var result = {};
    var progress = _.after(2, function() {
        callback(null, result);
    });

    user(username, function(error, user) {
        result.user = user;
        progress();
    });
    githubPaginate('https://api.github.com/users/' + username + '/following?per_page=100&page=0', function(error, _bodies) {
        if (error) return callback(error);
        var following = {};
        var addToFollowers = function(follower) {
            following[follower.id] = follower;
        };
        for (var bodyUrl in _bodies) {
            _bodies[bodyUrl].forEach(addToFollowers);
        }
        var followingArray = [];
        for (var id in following) {
            followingArray.push(following[id]);
        }
        result.following = followingArray;
        progress();
    });
};

var githubPaginate = function(url, callback, _bodies) {
    _bodies = _bodies || {};
    github(url, function (error, response, body) {
        if (!error || response.statusCode === 200) {
            if (!response.headers.link) {
                return callback(null, [body]);
            }
            var nextUrl = response.headers.link.match(/(?:^<)(.+?)(?:>)/)[1];
            if (_bodies[nextUrl]) {
                callback(null, _bodies);
            } else {
                _bodies[url] = body;
                githubPaginate(nextUrl, callback, _bodies);
            }
        } else {
            callback(error);
        }
    });
};
