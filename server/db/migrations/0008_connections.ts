// =============================================================================
// Migration 0008_connections
// =============================================================================
// Adds contact_connections: one row says how one contact relates to
// another of the same owner, such as "sister" or "colleague". The network view
// draws them, beside the people who share meetings and messages.
// contacts_owner_propagate is made again so an owner change reaches the new
// table too.
//
// What a migration may do: create, alter and drop tables, indexes and
// triggers, and move or fix data with SQL. It runs once per database, inside
// one transaction with its row in schema_migrations. If it throws, nothing it
// did is kept, and the server stops with this id in the error.
//
// What it may not do:
// - Import server/db.ts or a service. The code it calls can change later, and
//   this file must keep doing what it did when it shipped. Write the SQL here.
// - Change a migration that has shipped. Write a new one.
// - Run BEGIN, COMMIT, VACUUM, or a PRAGMA that cannot run in a transaction.
// - Build the FTS tables, the vec0 stores or the triggers that feed them. They
//   are rebuilt from code: raise the version in server/db/indexes.ts.
//
// What goes with it:
// - Every table and column it adds, mirrored in server/db/schema.ts, and the
//   name of every object it adds in ADDED_SINCE_FIXTURE in
//   tests/integration/db.migrations.test.ts. That test checks both.
// - A table with ownerId: OWNED_TABLES in server/db.ts and
//   scripts/tenant-lint.mjs, the delete loop of purgeOwner, and its owner
//   triggers here.
// - A new contacts column: drop and create the contacts_auto_updated_at and
//   contacts_score_dirty triggers again, with the column list of
//   contactEditColumns (server/db/helpers.ts).
// =============================================================================

import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE contact_connections (
      id TEXT PRIMARY KEY NOT NULL,
      contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      relatedContactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      createdAt TEXT DEFAULT (CURRENT_TIMESTAMP),
      ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT,
      CHECK (contactId != relatedContactId),
      UNIQUE (contactId, relatedContactId, type)
    );

    CREATE INDEX idx_contact_connections_owner_contact
      ON contact_connections(ownerId, contactId);
    CREATE INDEX idx_contact_connections_owner_related
      ON contact_connections(ownerId, relatedContactId);

    CREATE TRIGGER contact_connections_owner_fill AFTER INSERT ON contact_connections
           WHEN NEW.ownerId IS NULL
           BEGIN
             UPDATE contact_connections SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactId)
              WHERE id = NEW.id;
           END;

    CREATE TRIGGER contact_connections_owner_check BEFORE INSERT ON contact_connections
           WHEN NEW.ownerId IS NOT NULL AND (NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactId) OR NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.relatedContactId))
           BEGIN SELECT RAISE(ABORT, 'contact_connections.ownerId does not match the contact owner'); END;

    CREATE TRIGGER contact_connections_pair_check BEFORE INSERT ON contact_connections
           WHEN (SELECT ownerId FROM contacts WHERE id = NEW.contactId) IS NOT (SELECT ownerId FROM contacts WHERE id = NEW.relatedContactId)
           BEGIN SELECT RAISE(ABORT, 'contact_connections links contacts of two owners'); END;

    DROP TRIGGER contacts_owner_propagate;
    CREATE TRIGGER contacts_owner_propagate AFTER UPDATE OF ownerId ON contacts
         WHEN NEW.ownerId IS NOT OLD.ownerId
         BEGIN
           UPDATE interactions          SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
           UPDATE action_items          SET ownerId = NEW.ownerId WHERE contactId = NEW.id;
           UPDATE dedupe_suggestions    SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
           UPDATE dedupe_exclusions     SET ownerId = NEW.ownerId WHERE contactIdA = NEW.id OR contactIdB = NEW.id;
           UPDATE contact_connections SET ownerId = NEW.ownerId WHERE contactId = NEW.id OR relatedContactId = NEW.id;
         END;
  `);
}
