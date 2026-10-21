// Supported choices only. An event's saved stageNames remains its own scope.
const ALL_STAGES = Array.from({ length: 20 }, (_, index) => 'SS' + (index + 1))

module.exports = { ALL_STAGES }
