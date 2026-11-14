# Multi Mode Example

This no-build API v1 example declares two independent modes from one backend
plugin and registers their browser renderers explicitly. Copy this folder into
the LearnHarness plugins directory and enable it to inspect the server catalog
contract in a local build.

The backend owns catalog metadata, admission and instance initialization. The
frontend only registers renderers for the exact `pluginId` supplied by its
activation and the declared mode IDs. Each launch receives a new host workspace
ID and a plugin-owned storage namespace scoped to that ID. Disabling the plugin
removes it from the available catalog while retaining existing records and data.

The API is optional: the same plugin can keep its existing API v1 views and
actions without registering any modes.
