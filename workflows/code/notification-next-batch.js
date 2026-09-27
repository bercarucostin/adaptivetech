// Run Once for All Items: finish recording the batch before claiming more.
// Bound each execution to 20 batches (200 messages); future triggers resume the queue.
// Empty claim has no output and stops the loop. Never enable Always Output Data there.
return $runIndex < 19 ? [{ json: {} }] : [];
