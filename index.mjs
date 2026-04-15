//  CREATE TABLE seats (
//      id SERIAL PRIMARY KEY,
//      name VARCHAR(255),
//      isbooked INT DEFAULT 0
//  );
// INSERT INTO seats (isbooked)
// SELECT 0 FROM generate_series(1, 20);

import express from "express";
import pg from "pg";
import { dirname } from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { error } from "console";

const __dirname = dirname(fileURLToPath(import.meta.url));

const port = process.env.PORT || 8080;

const JWT_SECRET = "JWT_SECRET_KEY";

// Equivalent to mongoose connection
// Pool is nothing but group of connections
// If you pick one connection out of the pool and release it
// the pooler will keep that connection open for sometime to other clients to reuse
const pool = new pg.Pool({
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "postgres",
  database: "bookmyticketdb",
  max: 20,
  connectionTimeoutMillis: 0,
  idleTimeoutMillis: 0,
});

const app = new express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

app.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).send({ error: "All fields are required" });
    }

    const existing = await pool.query(
      "SELECT * FROM users WHERE email = $1 OR username = $2",
      [email, username],
    );
    if (existing.rowCount > 0) {
      return res.status(400).send({ error: "User already exists" });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
      "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id",
      [username, email, passwordHash],
    );

    const newUser = result.rows[0];

    const accessToken = jwt.sign(
      {
        id: newUser.id,
        username: newUser.username,
      },
      JWT_SECRET,
      { expiresIn: "5m" },
    );

    const refreshToken = jwt.sign(
      {
        id: newUser.id,
        username: newUser.username,
      },
      JWT_SECRET,
      { expiresIn: "1d" },
    );

    await pool.query("UPDATE users SET refresh_token = $1 WHERE id = $2", [
      refreshToken,
      newUser.id,
    ]);

    res.status(201).send({
      message: "User registered successfully",
      user: newUser,
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.log(error);
    res.status(500).send({ error: "Internal server error" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send({
        error: " Email and password are required",
      });
    }
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (result.rowCount === 0) {
      return res.status(401).send({
        error: "Invalid email or password",
      });
    }
    const user = result.rows[0];

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      return res.status(401).send({
        error: "Invalid email or password",
      });
    }

    const accessToken = jwt.sign(
      {
        id: user.id,
        username: user.username,
      },
      JWT_SECRET,
      { expiresIn: "5m" },
    );

    const refreshToken = jwt.sign(
      {
        id: user.id,
        username: user.username,
      },
      JWT_SECRET,
      { expiresIn: "1d" },
    );

    await pool.query("UPDATE users SET refresh_token = $1 WHERE id = $2", [
      refreshToken,
      user.id,
    ]);

    res.status(200).send({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.log(error);
    res.status(500).send({ error: error.message });
  }
});

const authenticate = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).send({
      error: "No token is set",
    });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).send({
      error: "Token is missing",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).send({
      error: "Invalid token",
    });
  }
};

app.post("/refresh-token", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).send({
        error: "Refresh token is required",
      });
    }

    const decoded = jwt.verify(refreshToken, JWT_SECRET);

    const result = await pool.query(
      "SELECT * FROM users WHERE id = $1 AND  refresh_token = $2",
      [decoded.id, refreshToken],
    );

    if (result.rowCount === 0) {
      return res.status(401).send({
        error: "Invalid refresh token",
      });
    }

    const newAccessToken = jwt.sign(
      {
        id: decoded.id,
        username: decoded.username,
      },
      JWT_SECRET,
      { expiresIn: "5m" },
    );
    res.status(200).send({
      accessToken: newAccessToken,
    });
  } catch (error) {
    return res.status(401).send({
      error: "Invalid or expired refresh token",
    });
  }
});

app.put("/book/:id", authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    const userId = req.user.id;
    const name = req.user.username;

    const conn = await pool.connect();
    await conn.query("BEGIN");

    const sql = "SELECT * FROM seats where id = $1 and isbooked = 0 FOR UPDATE";
    const result = await conn.query(sql, [id]);

    if (result.rowCount === 0) {
      await conn.query("ROLLBACK");
      conn.release();
      return res.status(409).send({ error: "Seat already booked" });
    }

    const sqlU =
      "update seats set isbooked = 1, name = $2, booked_by = $3 where id = $1";
    await conn.query(sqlU, [id, name, userId]);

    await conn.query("COMMIT");
    conn.release();
    res.status(200).send({
      message: `Seat ${id} booked successfully`,
      bookedBy: { id: userId, username: req.user.username },
    });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

//get all seats
app.get("/seats", async (req, res) => {
  const result = await pool.query("select * from seats"); // equivalent to Seats.find() in mongoose
  res.send(result.rows);
});

//book a seat give the seatId and your name

app.put("/:id/:name", authenticate, async (req, res) => {
  try {
    const id = req.params.id;
    const name = req.params.name;
    // payment integration should be here
    // verify payment
    const conn = await pool.connect(); // pick a connection from the pool
    //begin transaction
    // KEEP THE TRANSACTION AS SMALL AS POSSIBLE
    await conn.query("BEGIN");
    //getting the row to make sure it is not booked
    /// $1 is a variable which we are passing in the array as the second parameter of query function,
    // Why do we use $1? -> this is to avoid SQL INJECTION
    // (If you do ${id} directly in the query string,
    // then it can be manipulated by the user to execute malicious SQL code)
    const sql = "SELECT * FROM seats where id = $1 and isbooked = 0 FOR UPDATE";
    const result = await conn.query(sql, [id]);

    //if no rows found then the operation should fail can't book
    // This shows we Do not have the current seat available for booking
    if (result.rowCount === 0) {
      res.send({ error: "Seat already booked" });
      return;
    }
    //if we get the row, we are safe to update
    const sqlU = "update seats set isbooked = 1, name = $2 where id = $1";
    const updateResult = await conn.query(sqlU, [id, name]); // Again to avoid SQL INJECTION we are using $1 and $2 as placeholders

    //end transaction by committing
    await conn.query("COMMIT");
    conn.release(); // release the connection back to the pool (so we do not keep the connection open unnecessarily)
    res.send(updateResult);
  } catch (ex) {
    console.log(ex);
    res.send(500);
  }
});

app.listen(port, () => console.log("Server starting on port: " + port));
