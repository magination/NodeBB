'use strict';

var async = require('async'),
	path = require('path'),
	fs = require('fs'),
	nconf = require('nconf'),
	winston = require('winston'),
	request = require('request'),
	mime = require('mime'),

	plugins = require('../plugins'),
	file = require('../file'),
	image = require('../image'),
	meta = require('../meta');

module.exports = function(User) {

	User.uploadPicture = function (uid, picture, callback) {

		var uploadSize = parseInt(meta.config.maximumProfileImageSize, 10) || 256;
		var extension = path.extname(picture.name);
		var updateUid = uid;
		var imageDimension = parseInt(meta.config.profileImageDimension, 10) || 128;
		var convertToPNG = parseInt(meta.config['profile:convertProfileImageToPNG'], 10) === 1;

		async.waterfall([
			function(next) {
				next(parseInt(meta.config.allowProfileImageUploads) !== 1 ? new Error('[[error:profile-image-uploads-disabled]]') : null);
			},
			function(next) {
				next(picture.size > uploadSize * 1024 ? new Error('[[error:file-too-big, ' + uploadSize + ']]') : null);
			},
			function(next) {
				next(!extension ? new Error('[[error:invalid-image-extension]]') : null);
			},
			function(next) {
				file.isFileTypeAllowed(picture.path, ['png', 'jpeg', 'jpg', 'gif'], next);
			},
			function(next) {
				image.resizeImage({
					path: picture.path,
					extension: extension,
					width: imageDimension,
					height: imageDimension
				}, next);
			},
			function(next) {
				if (convertToPNG) {
					image.normalise(picture.path, extension, next);
				} else {
					next();
				}
			}
		], function(err, result) {
			function done(err, image) {
				if (err) {
					return callback(err);
				}

				User.setUserFields(updateUid, {uploadedpicture: image.url, picture: image.url});

				callback(null, image);
			}

			if (err) {
				return callback(err);
			}

			if (plugins.hasListeners('filter:uploadImage')) {
				return plugins.fireHook('filter:uploadImage', {image: picture, uid: updateUid}, done);
			}

			var filename = updateUid + '-profileimg' + (convertToPNG ? '.png' : extension);

			User.getUserField(updateUid, 'uploadedpicture', function (err, oldpicture) {
				if (err) {
					return callback(err);
				}

				if (!oldpicture) {
					return file.saveFileToLocal(filename, 'profile', picture.path, done);
				}

				var absolutePath = path.join(nconf.get('base_dir'), nconf.get('upload_path'), 'profile', path.basename(oldpicture));

				fs.unlink(absolutePath, function (err) {
					if (err) {
						winston.error(err);
					}

					file.saveFileToLocal(filename, 'profile', picture.path, done);
				});
			});
		});
	};

	User.uploadFromUrl = function(uid, url, callback) {
		if (!plugins.hasListeners('filter:uploadImage')) {
			return callback(new Error('[[error:no-plugin]]'));
		}

		request.head(url, function(err, res, body) {
			if (err) {
				return callback(err);
			}
			var uploadSize = parseInt(meta.config.maximumProfileImageSize, 10) || 256;
			var size = res.headers['content-length'];
			var type = res.headers['content-type'];
			var extension = mime.extension(type);

			if (['png', 'jpeg', 'jpg', 'gif'].indexOf(extension) === -1) {
				return callback(new Error('[[error:invalid-image-extension]]'));
			}

			if (size > uploadSize * 1024) {
				return callback(new Error('[[error:file-too-big, ' + uploadSize + ']]'));
			}

			var picture = {url: url, name: ''};
			plugins.fireHook('filter:uploadImage', {image: picture, uid: uid}, function(err, image) {
				if (err) {
					return callback(err);
				}
				User.setUserFields(uid, {uploadedpicture: image.url, picture: image.url});
				callback(null, image);
			});
		});
	};
};