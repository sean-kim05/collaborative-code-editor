from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timezone

db = SQLAlchemy()


class Room(db.Model):
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
    __tablename__ = 'room_files'
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.String(64), db.ForeignKey('rooms.room_id', ondelete='CASCADE'), nullable=False, index=True)
    file_id = db.Column(db.String(64), nullable=False)
    name = db.Column(db.String(256), nullable=False)
    content = db.Column(db.Text, default='')
    language = db.Column(db.String(64), default='javascript')
    updated_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class RoomMessage(db.Model):
    __tablename__ = 'room_messages'
    id = db.Column(db.Integer, primary_key=True)
    room_id = db.Column(db.String(64), db.ForeignKey('rooms.room_id', ondelete='CASCADE'), nullable=False, index=True)
    username = db.Column(db.String(128))
    color = db.Column(db.String(32))
    content = db.Column(db.Text)
    timestamp = db.Column(db.String(64))
