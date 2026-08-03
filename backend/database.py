"""SQLAlchemy models — the durable half of the storage layer (see rooms.py).

Rooms join to files and messages on the public `room_id` string (the value in
the URL), not on the surrogate integer primary key. That keeps every lookup in
`rooms.py` a single query straight from the id the client already has, with no
prior fetch to resolve a foreign key.

`cascade='all, delete-orphan'` plus `ondelete='CASCADE'` covers deletion at both
levels: the ORM cleans up when the reaper deletes a Room object, and the DB
constraint holds even for a direct SQL delete.
"""
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timezone

db = SQLAlchemy()


class Room(db.Model):
    """One collaborative session.

    `last_active` is bumped on every file write and is what the 30-day expiry
    reaper reads. `active_file_id` is the room's default landing tab, not a
    per-user cursor — individual tab switches stay client-side.
    """
    __tablename__ = 'rooms'
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.String(64), unique=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_active = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    visibility = db.Column(db.String(16), default='public')
    password = db.Column(db.String(256))
    active_file_id = db.Column(db.String(64))
    files = db.relationship('RoomFile', backref='room', lazy=True, cascade='all, delete-orphan',
                            primaryjoin='Room.room_id == RoomFile.room_id', foreign_keys='RoomFile.room_id')
    messages = db.relationship('RoomMessage', backref='room', lazy=True, cascade='all, delete-orphan',
                               primaryjoin='Room.room_id == RoomMessage.room_id', foreign_keys='RoomMessage.room_id')


class RoomFile(db.Model):
    """One file in a room's tree.

    `file_id` is the uuid minted by `make_file` and is the key everything else
    addresses — socket `code_change` payloads, snapshots, and the reconcile in
    `store_file_system`. The integer `id` is a storage detail that never leaves
    the database.
    """
    __tablename__ = 'room_files'
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.String(64), db.ForeignKey('rooms.room_id', ondelete='CASCADE'), nullable=False, index=True)
    file_id = db.Column(db.String(64), nullable=False)
    name = db.Column(db.String(256), nullable=False)
    content = db.Column(db.Text, default='')
    language = db.Column(db.String(64), default='javascript')
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RoomMessage(db.Model):
    """Chat message. Table exists but nothing writes to it yet — `send_message`
    currently broadcasts without persisting, so chat history is per-session.
    This is the schema for wiring it up."""
    __tablename__ = 'room_messages'
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.String(64), db.ForeignKey('rooms.room_id', ondelete='CASCADE'), nullable=False, index=True)
    username = db.Column(db.String(128))
    color = db.Column(db.String(32))
    content = db.Column(db.Text)
    timestamp = db.Column(db.String(64))
