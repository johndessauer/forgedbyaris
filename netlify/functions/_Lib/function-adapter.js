// Turns a Fetch request into the event shape the Marketing handlers already
// use, and turns their JSON result back into a Fetch response.
async function fromRequest(req) {
  const url = new URL(req.url);
  const params = {};
  url.searchParams.forEach(function (value, key) { params[key] = value; });
  const headers = {};
  req.headers.forEach(function (value, key) { headers[key] = value; });
  return {
    httpMethod: req.method,
    headers: headers,
    body: await req.text(),
    isBase64Encoded: false,
    queryStringParameters: params,
    rawUrl: req.url,
  };
}

function toResponse(result) {
  return new Response(result && result.body ? result.body : '', {
    status: result && result.statusCode ? result.statusCode : 500,
    headers: Object.assign({}, result && result.headers),
  });
}

module.exports = { fromRequest: fromRequest, toResponse: toResponse };
