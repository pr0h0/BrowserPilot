// Tables are created on boot by importing the client. This entrypoint exists so
// `bun db:migrate` does something sensible without a separate migration runner.
import "./client.js";
console.log("DB ready (tables ensured via CREATE TABLE IF NOT EXISTS).");
