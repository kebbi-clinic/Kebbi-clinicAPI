/* Serialise Mongoose docs to plain JSON-safe objects (strips _id internals). */
function clean(doc) {
  return JSON.parse(JSON.stringify(doc))
}

function cleanList(docs) {
  return (docs || []).map(clean)
}

module.exports = { clean, cleanList }
