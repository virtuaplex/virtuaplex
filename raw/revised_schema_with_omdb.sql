-- Operators table (for theater managers who log in via GitHub)
CREATE TABLE operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    github_id TEXT NOT NULL UNIQUE,
    github_username TEXT NOT NULL,
    github_avatar_url TEXT,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Theaters table
CREATE TABLE theaters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    capacity INTEGER NOT NULL DEFAULT 50,
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (created_by) REFERENCES operators(id) ON DELETE CASCADE
);

-- Films table (with OMDB integration)
CREATE TABLE films (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    omdb_id TEXT UNIQUE, -- OMDB ID (imdbID)
    description TEXT,
    release_year INTEGER,
    duration_minutes INTEGER NOT NULL,
    magnet_link TEXT NOT NULL,
    poster_url TEXT,
    genre TEXT,
    director TEXT,
    is_public_domain BOOLEAN DEFAULT TRUE,
    added_by INTEGER NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (added_by) REFERENCES operators(id) ON DELETE CASCADE
);

-- Film metadata table (for additional metadata not in OMDB)
CREATE TABLE film_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    film_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE,
    UNIQUE(film_id, key)
);

-- Schedules table
CREATE TABLE schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theater_id INTEGER NOT NULL,
    film_id INTEGER NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    is_recurring BOOLEAN DEFAULT FALSE,
    recurrence_pattern TEXT, -- JSON pattern for recurring schedules
    created_by INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (theater_id) REFERENCES theaters(id) ON DELETE CASCADE,
    FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES operators(id) ON DELETE CASCADE
);

-- Active Screenings table (minimal state for currently running shows)
CREATE TABLE active_screenings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theater_id INTEGER NOT NULL,
    schedule_id INTEGER NOT NULL,
    film_id INTEGER NOT NULL,
    room_code TEXT NOT NULL UNIQUE, -- Used for WebRTC signaling
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (theater_id) REFERENCES theaters(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (film_id) REFERENCES films(id) ON DELETE CASCADE
);

-- Seats table (minimal state just to prevent conflicts)
CREATE TABLE active_seats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    screening_id INTEGER NOT NULL,
    row_number INTEGER NOT NULL,
    seat_number INTEGER NOT NULL,
    visitor_id TEXT NOT NULL, -- Anonymous ID for moviegoer
    display_name TEXT NOT NULL, -- Visitor's display name
    last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (screening_id) REFERENCES active_screenings(id) ON DELETE CASCADE,
    UNIQUE(screening_id, row_number, seat_number)
);

-- Indices for performance
CREATE INDEX idx_theaters_created_by ON theaters(created_by);
CREATE INDEX idx_films_added_by ON films(added_by);
CREATE INDEX idx_films_omdb_id ON films(omdb_id);
CREATE INDEX idx_schedules_theater ON schedules(theater_id);
CREATE INDEX idx_schedules_film ON schedules(film_id);
CREATE INDEX idx_schedules_start_time ON schedules(start_time);
CREATE INDEX idx_active_screenings_theater ON active_screenings(theater_id);
CREATE INDEX idx_active_screenings_schedule ON active_screenings(schedule_id);
CREATE INDEX idx_active_seats_screening ON active_seats(screening_id);
CREATE INDEX idx_film_metadata_film ON film_metadata(film_id);