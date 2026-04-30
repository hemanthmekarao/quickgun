CREATE DATABASE IF NOT EXISTS domain_search
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE domain_search;

CREATE TABLE IF NOT EXISTS users (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email       VARCHAR(255) NOT NULL,
  password    VARCHAR(255) NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS search_history (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  query       VARCHAR(253) NOT NULL,
  category    VARCHAR(50)  NOT NULL DEFAULT 'popular',
  results     JSON         NOT NULL,
  searched_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_history_user_id   (user_id),
  KEY idx_history_searched  (searched_at),
  CONSTRAINT fk_history_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
