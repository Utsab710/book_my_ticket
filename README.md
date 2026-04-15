# BookMyTicket — Backend

A simplified movie seat booking platform with user authentication and protected booking endpoints, built with Node.js, Express, and PostgreSQL.

---

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Framework**: Express.js
- **Database**: PostgreSQL (via `pg` Pool)
- **Auth**: JWT (access + refresh tokens)
- **Password Hashing**: bcrypt
- **CORS**: enabled

---

## Prerequisites

- Node.js v18+
- PostgreSQL 14+

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-username/bookmyticket.git
cd bookmyticket
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up the database

Open your PostgreSQL client (psql or pgAdmin) and run:

```sql
-- Create the database
CREATE DATABASE bookmyticketdb;

-- Connect to it
\c bookmyticketdb

-- Create users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    refresh_token TEXT
);

-- Create seats table
CREATE TABLE seats (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    isbooked INT DEFAULT 0,
    booked_by INTEGER REFERENCES users(id)
);

-- Seed 20 seats
INSERT INTO seats (isbooked)
SELECT 0 FROM generate_series(1, 20);
```

### 4. Configure database connection

In `index.js`, update the pool config if your PostgreSQL credentials differ:

```js
const pool = new pg.Pool({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "postgres",
  database: "bookmyticketdb",
});
```

### 5. Start the server

```bash
node index.js
```

Server runs on `http://localhost:8080`

---

## API Reference

### Auth

#### `POST /register`

Register a new user.

**Request body:**

```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "secret123"
}
```

**Response:**

```json
{
  "message": "User registered successfully",
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>"
}
```

---

#### `POST /login`

Login with existing credentials.

**Request body:**

```json
{
  "email": "alice@example.com",
  "password": "secret123"
}
```

**Response:**

```json
{
  "message": "Login successful",
  "user": { "id": 1, "username": "alice", "email": "alice@example.com" },
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>"
}
```

---

#### `POST /refresh-token`

Get a new access token using a refresh token.

**Request body:**

```json
{
  "refreshToken": "<your_refresh_token>"
}
```

**Response:**

```json
{
  "accessToken": "<new_jwt>"
}
```

---

### Seats

#### `GET /seats`

Get all seats with their booking status. Public endpoint.

**Response:**

```json
[
  { "id": 1, "name": null, "isbooked": 0, "booked_by": null },
  { "id": 2, "name": "alice", "isbooked": 1, "booked_by": 3 }
]
```

---

#### `PUT /book/:id` 🔒 Protected

Book a seat by its ID. Requires a valid access token.

**Headers:**

```
Authorization: Bearer <access_token>
```

**Response:**

```json
{
  "message": "Seat 5 booked successfully",
  "bookedBy": { "id": 3, "username": "alice" }
}
```

**Error (already booked):**

```json
{ "error": "Seat already booked" }
```

---

## Authentication Flow

```
1. Register  →  receive accessToken (5min) + refreshToken (1 day)
2. Call protected endpoints with:  Authorization: Bearer <accessToken>
3. When accessToken expires  →  POST /refresh-token to get a new one
4. refreshToken is stored in DB and validated on each refresh
```

---

## Seat Booking — Concurrency Safety

Seat booking uses a **PostgreSQL transaction with `FOR UPDATE` row lock** to prevent race conditions:

```
BEGIN
  SELECT seat WHERE id = ? AND isbooked = 0  FOR UPDATE  ← locks the row
  if not found → ROLLBACK, return error
  UPDATE seat SET isbooked = 1, booked_by = userId
COMMIT
```

This ensures that even if two users try to book the same seat simultaneously, only one succeeds.

---

## Project Structure

```
bookmyticket/
├── index.js        # All routes and server logic
├── package.json
└── README.md
```

---

## Notes

- JWT secret is hardcoded as `JWT_SECRET_KEY` for development. In production, move it to an environment variable.
- Movie data is mocked — seats are generic and not tied to a specific movie.
- Frontend is not included in this submission.
