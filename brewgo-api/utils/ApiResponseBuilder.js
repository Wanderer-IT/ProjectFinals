// BUILDER PATTERN (from the "Design Patterns in APIs" lecture):
// the response envelope is assembled step by step with a fluent API.
//   success -> { success: true,  data, meta }
//   failure -> { success: false, error: { code, message, details }, requestId }
class ApiResponseBuilder {
  constructor() {
    this.statusCode = 200;
    this.body = {};
  }
  status(code) { this.statusCode = code; return this; }
  success(data) { this.body.success = true; this.body.data = data; return this; }
  meta(meta) { if (meta !== undefined) this.body.meta = meta; return this; }
  failure(code, message, details) {
    this.body.success = false;
    this.body.error = { code, message };
    if (details !== undefined) this.body.error.details = details;
    return this;
  }
  requestId(id) { this.body.requestId = id; return this; }
  build() { return { status: this.statusCode, body: this.body }; }
  send(res) { return res.status(this.statusCode).json(this.body); }
}

module.exports = ApiResponseBuilder;
