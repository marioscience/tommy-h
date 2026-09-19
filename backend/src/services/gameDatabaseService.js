import mysql from 'mysql2/promise';
import { config } from '../config.js';

async function connectAsAdministrator() {
  return mysql.createConnection({
    host: process.env.MARIADB_HOST || 'mariadb',
    user: 'root',
    password: config.centralDbPass,
    port: Number(process.env.MARIADB_PORT || 3306)
  });
}

export async function createGameDatabase(dbName, dbUser, dbPass) {
  const connection = await connectAsAdministrator();
  try {
    const escapedDatabase = mysql.escapeId(dbName);
    const escapedUser = mysql.escape(dbUser);
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${escapedDatabase} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`CREATE USER IF NOT EXISTS ${escapedUser}@'%' IDENTIFIED BY ?`, [dbPass]);
    await connection.query(`GRANT ALL PRIVILEGES ON ${escapedDatabase}.* TO ${escapedUser}@'%'`);
    await connection.query('FLUSH PRIVILEGES');
  } finally {
    await connection.end();
  }
}

export async function removeGameDatabase(dbName, dbUser) {
  const connection = await connectAsAdministrator();
  try {
    await connection.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(dbName)}`);
    await connection.query(`DROP USER IF EXISTS ${mysql.escape(dbUser)}@'%'`);
  } finally {
    await connection.end();
  }
}
