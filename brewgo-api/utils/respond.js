const ApiResponseBuilder = require("./ApiResponseBuilder");

exports.ok = (res, data, meta) => new ApiResponseBuilder().status(200).success(data).meta(meta).send(res);
exports.created = (res, data, meta) => new ApiResponseBuilder().status(201).success(data).meta(meta).send(res);
exports.noContent = (res) => res.status(204).send();
