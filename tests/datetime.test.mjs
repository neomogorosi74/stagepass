import test from 'node:test'
import assert from 'node:assert/strict'
import { toJohannesburgIso, toJohannesburgLocalInput } from '../src/utils/datetime.js'

test('winter datetime-local is treated as Johannesburg time', () => {
  assert.equal(toJohannesburgIso('2026-06-15T18:00'), '2026-06-15T16:00:00.000Z')
})

test('summer datetime-local is treated as Johannesburg time', () => {
  assert.equal(toJohannesburgIso('2026-12-15T18:00'), '2026-12-15T16:00:00.000Z')
})

test('explicit +02:00 offset is preserved', () => {
  assert.equal(toJohannesburgIso('2026-06-15T18:00:00+02:00'), '2026-06-15T16:00:00.000Z')
})

test('explicit Z offset is preserved', () => {
  assert.equal(toJohannesburgIso('2026-06-15T16:00:00Z'), '2026-06-15T16:00:00.000Z')
})

test('invalid values throw', () => {
  assert.throws(() => toJohannesburgIso('not-a-date'), /Invalid date\/time/)
})

test('empty values stay empty', () => {
  assert.equal(toJohannesburgIso(''), '')
  assert.equal(toJohannesburgIso(null), '')
})

test('UTC timestamps convert to Johannesburg datetime-local input', () => {
  assert.equal(toJohannesburgLocalInput('2026-06-15T16:00:00.000Z'), '2026-06-15T18:00')
  assert.equal(toJohannesburgLocalInput('2026-12-15T16:00:00Z'), '2026-12-15T18:00')
})

test('invalid local input conversion is empty', () => {
  assert.equal(toJohannesburgLocalInput('not-a-date'), '')
  assert.equal(toJohannesburgLocalInput(''), '')
  assert.equal(toJohannesburgLocalInput(null), '')
})
