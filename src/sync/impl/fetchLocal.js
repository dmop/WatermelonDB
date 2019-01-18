// @flow

import {
  // $FlowFixMe
  promiseAllObject,
  map,
  reduce,
  values,
  pipe,
} from 'rambdax'
import { unnest } from '../../utils/fp'
import type { Database, Collection, Model } from '../..'
import * as Q from '../../QueryDescription'
import { columnName } from '../../Schema'

import type { SyncTableChangeSet, SyncDatabaseChangeSet } from '../index'
import { ensureActionsEnabled } from './helpers'

export type SyncLocalChanges = $Exact<{ changes: SyncDatabaseChangeSet, affectedRecords: Model[] }>

const notSyncedQuery = Q.where(columnName('_status'), Q.notEq('synced'))
// TODO: It would be best to omit _status, _changed fields, since they're not necessary for the server
// but this complicates markLocalChangesAsDone, since we don't have the exact copy to compare if record changed
// TODO: It would probably also be good to only send to server locally changed fields, not full records
const rawsForStatus = (status, records) =>
  reduce(
    (raws, record) => (record._raw._status === status ? raws.concat({ ...record._raw }) : raws),
    [],
    records,
  )

async function fetchLocalChangesForCollection<T: Model>(
  collection: Collection<T>,
): Promise<[SyncTableChangeSet, T[]]> {
  const changedRecords = await collection.query(notSyncedQuery).fetch()
  const changeSet = {
    created: rawsForStatus('created', changedRecords),
    updated: rawsForStatus('updated', changedRecords),
    deleted: await collection.database.adapter.getDeletedRecords(collection.table),
  }
  return [changeSet, changedRecords]
}

const extractChanges = map(([changeSet]) => changeSet)
const extractAllAffectedRecords = pipe(
  values,
  map(([, records]) => records),
  unnest,
)

export default function fetchLocalChanges(db: Database): Promise<SyncLocalChanges> {
  ensureActionsEnabled(db)
  return db.action(async () => {
    const changes = await promiseAllObject(
      map(
        fetchLocalChangesForCollection,
        // $FlowFixMe
        db.collections.map,
      ),
    )
    // TODO: deep-freeze changes object (in dev mode only) to detect mutations (user bug)
    return {
      // $FlowFixMe
      changes: extractChanges(changes),
      affectedRecords: extractAllAffectedRecords(changes),
    }
  }, 'sync-fetchLocalChanges')
}