-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Nov 08, 2026 at 06:03 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `project_poin`
--
-- Juniper Cafe POS: PART 1 = original schema (unchanged), PART 2 = migration to match
-- the prototype, PART 3 = seed data from the prototype. Import into an EMPTY database.
--

-- --------------------------------------------------------

--
-- Table structure for table `categories`
--

CREATE TABLE `categories` (
  `id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `forecast_results`
--

CREATE TABLE `forecast_results` (
  `id` int(11) NOT NULL,
  `product_id` int(11) DEFAULT NULL,
  `category_id` int(11) DEFAULT NULL,
  `forecast_date` date NOT NULL,
  `predicted_quantity` decimal(12,2) NOT NULL CHECK (`predicted_quantity` >= 0),
  `model_name` varchar(100) NOT NULL,
  `model_version` varchar(50) DEFAULT NULL,
  `generated_at` timestamp NOT NULL DEFAULT current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Table structure for table `products`
--

CREATE TABLE `products` (
  `id` int(11) NOT NULL,
  `sku` varchar(80) NOT NULL,
  `name` varchar(150) NOT NULL,
  `category_id` int(11) NOT NULL,
  `price` decimal(12,2) NOT NULL CHECK (`price` >= 0),
  `cost_price` decimal(12,2) NOT NULL DEFAULT 0.00 CHECK (`cost_price` >= 0),
  `stock_quantity` int(11) NOT NULL DEFAULT 0 CHECK (`stock_quantity` >= 0),
  `reorder_level` int(11) NOT NULL DEFAULT 0 CHECK (`reorder_level` >= 0),
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `roles`
--

CREATE TABLE `roles` (
  `id` int(11) NOT NULL,
  `name` varchar(50) NOT NULL,
  `description` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `stock_movements`
--

CREATE TABLE `stock_movements` (
  `id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `movement_type` varchar(30) NOT NULL,
  `quantity` int(11) NOT NULL CHECK (`quantity` > 0),
  `reference` varchar(100) DEFAULT NULL,
  `performed_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Table structure for table `transactions`
--

CREATE TABLE `transactions` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `transaction_number` varchar(80) NOT NULL,
  `subtotal` decimal(12,2) NOT NULL CHECK (`subtotal` >= 0),
  `tax` decimal(12,2) NOT NULL DEFAULT 0.00 CHECK (`tax` >= 0),
  `discount` decimal(12,2) NOT NULL DEFAULT 0.00 CHECK (`discount` >= 0),
  `total` decimal(12,2) NOT NULL CHECK (`total` >= 0),
  `payment_method` varchar(40) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Table structure for table `transaction_items`
--

CREATE TABLE `transaction_items` (
  `id` int(11) NOT NULL,
  `transaction_id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `quantity` int(11) NOT NULL CHECK (`quantity` > 0),
  `unit_price` decimal(12,2) NOT NULL CHECK (`unit_price` >= 0),
  `line_total` decimal(12,2) NOT NULL
) ;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(254) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `role_id` int(11) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `categories`
--
ALTER TABLE `categories`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `name` (`name`);

--
-- Indexes for table `forecast_results`
--
ALTER TABLE `forecast_results`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_forecast_product_date` (`product_id`,`forecast_date`),
  ADD KEY `idx_forecast_category_date` (`category_id`,`forecast_date`);

--
-- Indexes for table `products`
--
ALTER TABLE `products`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `sku` (`sku`),
  ADD KEY `fk_products_category` (`category_id`);

--
-- Indexes for table `roles`
--
ALTER TABLE `roles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `name` (`name`);

--
-- Indexes for table `stock_movements`
--
ALTER TABLE `stock_movements`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_movements_user` (`performed_by`),
  ADD KEY `idx_stock_product_created` (`product_id`,`created_at`);

--
-- Indexes for table `transactions`
--
ALTER TABLE `transactions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `transaction_number` (`transaction_number`),
  ADD KEY `fk_transactions_user` (`user_id`),
  ADD KEY `idx_transactions_created` (`created_at`);

--
-- Indexes for table `transaction_items`
--
ALTER TABLE `transaction_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_items_transaction` (`transaction_id`),
  ADD KEY `fk_items_product` (`product_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `fk_users_role` (`role_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `categories`
--
ALTER TABLE `categories`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `forecast_results`
--
ALTER TABLE `forecast_results`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `products`
--
ALTER TABLE `products`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `roles`
--
ALTER TABLE `roles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `stock_movements`
--
ALTER TABLE `stock_movements`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `transactions`
--
ALTER TABLE `transactions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `transaction_items`
--
ALTER TABLE `transaction_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `forecast_results`
--
ALTER TABLE `forecast_results`
  ADD CONSTRAINT `fk_forecast_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`),
  ADD CONSTRAINT `fk_forecast_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`);

--
-- Constraints for table `products`
--
ALTER TABLE `products`
  ADD CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`);

--
-- Constraints for table `stock_movements`
--
ALTER TABLE `stock_movements`
  ADD CONSTRAINT `fk_movements_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  ADD CONSTRAINT `fk_movements_user` FOREIGN KEY (`performed_by`) REFERENCES `users` (`id`);

--
-- Constraints for table `transactions`
--
ALTER TABLE `transactions`
  ADD CONSTRAINT `fk_transactions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `transaction_items`
--
ALTER TABLE `transaction_items`
  ADD CONSTRAINT `fk_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  ADD CONSTRAINT `fk_items_transaction` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`);

--
-- Constraints for table `users`
--
ALTER TABLE `users`
  ADD CONSTRAINT `fk_users_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`);

-- =====================================================================
-- PART 2: migration - align the schema with the prototype
-- =====================================================================

-- products: photo URL, and 4-decimal cost (ingredient costs are per gram, e.g. RM 0.0035)
ALTER TABLE `products`
  ADD COLUMN `image_url` varchar(500) DEFAULT NULL AFTER `reorder_level`,
  MODIFY `cost_price` decimal(12,4) NOT NULL DEFAULT 0.0000 CHECK (`cost_price` >= 0);

-- transactions: sales AND supplier purchases, with status and the full bill breakdown
ALTER TABLE `transactions`
  ADD COLUMN `client_request_id` varchar(64) DEFAULT NULL AFTER `transaction_number`,
  ADD UNIQUE KEY `uq_tx_client_request` (`client_request_id`),
  ADD COLUMN `transaction_type` varchar(20) NOT NULL DEFAULT 'SALE' AFTER `client_request_id`,
  ADD COLUMN `status` varchar(20) NOT NULL DEFAULT 'POSTED' AFTER `transaction_type`,
  ADD COLUMN `service_charge` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `subtotal`,
  ADD COLUMN `rounding_adjustment` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `discount`,
  MODIFY `payment_method` varchar(40) DEFAULT NULL,
  ADD CONSTRAINT `chk_tx_type` CHECK (`transaction_type` IN ('SALE','PURCHASE')),
  ADD CONSTRAINT `chk_tx_status` CHECK (`status` IN ('DRAFT','POSTED','CANCELLED')),
  ADD CONSTRAINT `chk_tx_service_charge` CHECK (`service_charge` >= 0),
  ADD CONSTRAINT `chk_tx_payment` CHECK (`payment_method` IS NULL OR `payment_method` IN ('Cash','Card','QR')),
  ADD KEY `idx_transactions_type_status` (`transaction_type`,`status`);

-- transaction_items: unit cost needs 4 decimals for ingredient purchases
ALTER TABLE `transaction_items`
  MODIFY `unit_price` decimal(12,4) NOT NULL CHECK (`unit_price` >= 0);

-- stock_movements: the prototype stores a signed change (-2 for a sale, +20 for a delivery,
-- -1 for a damaged unit). Replace the positive-only quantity with a signed quantity_change.
ALTER TABLE `stock_movements`
  CHANGE `quantity` `quantity_change` int(11) NOT NULL;
ALTER TABLE `stock_movements`
  ADD CONSTRAINT `chk_movement_nonzero` CHECK (`quantity_change` <> 0),
  ADD CONSTRAINT `chk_movement_type` CHECK (`movement_type` IN ('SALE','PURCHASE','ADJUSTMENT'));

-- forecast_results: the prototype shows predicted demand over the next 7 days
ALTER TABLE `forecast_results`
  ADD COLUMN `horizon_days` int(11) NOT NULL DEFAULT 1 AFTER `forecast_date`;

-- recipes: bill of materials (one row per ingredient per finished product)
CREATE TABLE `recipes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` int(11) NOT NULL,
  `ingredient_id` int(11) NOT NULL,
  `quantity_required` decimal(12,3) NOT NULL CHECK (`quantity_required` > 0),
  `unit` varchar(20) NOT NULL CHECK (`unit` <> ''),
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recipe_product_ingredient` (`product_id`,`ingredient_id`),
  KEY `fk_recipes_ingredient` (`ingredient_id`),
  CONSTRAINT `fk_recipes_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `fk_recipes_ingredient` FOREIGN KEY (`ingredient_id`) REFERENCES `products` (`id`),
  CONSTRAINT `chk_recipe_not_self` CHECK (`product_id` <> `ingredient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- settings: rates and the recipe target margin that the prototype keeps as constants
CREATE TABLE `settings` (
  `setting_key` varchar(60) NOT NULL,
  `setting_value` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =====================================================================
-- PART 3: seed data - everything hard-coded in the prototype (src/App.tsx)
-- Times are stored in UTC (session time_zone is +00:00); the app shows them
-- in Malaysia Time, UTC+8. e.g. 02:31 UTC = 10:31 MYT.
-- =====================================================================

INSERT INTO `settings` (`setting_key`, `setting_value`, `description`) VALUES
('service_charge_rate', '0.10', 'Service charge on the sale subtotal'),
('sst_rate', '0.06', 'SST on the sale subtotal (not on the service charge)'),
('rounding', 'NEAREST_5_SEN', 'Bill total rounded to the nearest 5 sen (all payment methods)'),
('recipe_target_margin', '0.60', 'Target profit margin used by the Recipes screen'),
('timezone', 'Asia/Kuala_Lumpur', 'Display time zone (UTC+8)');

INSERT INTO `roles` (`id`, `name`, `description`) VALUES
(1, 'ADMIN', 'Full access: sales, products, recipes, inventory, forecasts, users'),
(2, 'STAFF', 'Sales screens only: new sale and transactions');

-- Demo password for every account: Juniper@2026  (bcrypt, cost 12). Change before go-live.
INSERT INTO `users` (`id`, `name`, `email`, `password_hash`, `role_id`, `is_active`, `created_at`, `updated_at`) VALUES
(1, 'Kaung Htet Nyein', 'kaunghtet@juniper.store', '$2b$12$nG1UTB1uo8fjrYSL0Y.MX.TDa2XWipJUVebHxkkJWMqZmhPtuCxXG', 1, 1, '2026-01-12 01:00:00', '2026-01-12 01:00:00'),
(2, 'Yadanar Theint', 'yadanar@juniper.store', '$2b$12$z5MZxNnGCz4PGZgbGMeRbukdHHhjdnBUIvi8G1k7gCOZxMfJ2Dy1W', 2, 1, '2026-02-03 01:00:00', '2026-02-03 01:00:00'),
(3, 'Zin Ko Oo', 'zinkooo@juniper.store', '$2b$12$Pi4tGPEm2/t0P.Mqhm0ddOyck3/0g9s2jQVi3YHMIkDDmyvtkoUfe', 2, 1, '2026-03-19 01:00:00', '2026-03-19 01:00:00'),
(4, 'Peh Yan Bin', 'yanbin@juniper.store', '$2b$12$isvRjof7GFkNDsqXDImneO5zZG5a8HSAAfjeYfFgtwdIP7cGVF09W', 2, 1, '2026-04-07 01:00:00', '2026-04-07 01:00:00'),
(5, 'Tan Yaw Pin', 'yawpin@juniper.store', '$2b$12$wgdsQoiRrJ/kDY5AfkmNoueGgIkEalgIR4Sd6dTc7i0JqScOSghli', 2, 1, '2026-04-21 01:00:00', '2026-04-21 01:00:00'),
(6, 'Khong Cheng Hao', 'chenghao@juniper.store', '$2b$12$9/IMt20q1XKsvwzF9uMPwuxn1Q8uUSyMVGonJQIzGNgxHnD3Xw4hm', 2, 1, '2026-05-05 01:00:00', '2026-05-05 01:00:00');

INSERT INTO `categories` (`id`, `name`, `description`) VALUES
(1, 'Coffee', 'Coffee beans and coffee products'),
(2, 'Bakery', 'Baked goods made in-house'),
(3, 'Ready meals', 'Prepared meals'),
(4, 'Pantry', 'Packaged retail items'),
(5, 'Drinks', 'Bottled and ready-to-drink beverages'),
(6, 'Ingredients', 'Raw ingredients used in recipes; stock in base units (g, ml or piece)');

-- Ingredients use category 6; price 0 (not sold). cost_price = latest posted purchase cost.
INSERT INTO `products` (`id`, `sku`, `name`, `category_id`, `price`, `cost_price`, `stock_quantity`, `reorder_level`, `image_url`, `is_active`, `created_at`, `updated_at`) VALUES
(1, 'CAF-001', 'House Roast Beans', 1, 18.00, 0.0000, 24, 10, 'https://images.unsplash.com/photo-1564327367919-cb377ea6a88f?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(2, 'BAK-014', 'Butter Croissant', 2, 4.50, 2.4000, 8, 10, 'https://images.unsplash.com/photo-1704283735270-f973e7e9c14e?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(3, 'MEA-008', 'Chicken Grain Bowl', 3, 13.50, 0.0000, 12, 6, 'https://images.unsplash.com/photo-1730871082582-49e083b500a1?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(4, 'PAN-021', 'Juniper Granola', 4, 11.00, 0.0000, 19, 8, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(5, 'BAK-019', 'Blueberry Loaf', 2, 6.50, 0.0000, 6, 8, 'https://images.unsplash.com/photo-1529942458412-eda69f76291d?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(6, 'MEA-012', 'Focaccia Sandwich', 3, 12.00, 0.0000, 15, 7, 'https://images.unsplash.com/photo-1730871082582-49e083b500a1?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(7, 'DRK-033', 'Cold Brew Bottle', 5, 6.00, 0.0000, 31, 12, 'https://images.unsplash.com/photo-1564327367919-cb377ea6a88f?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(8, 'PAN-025', 'Matcha Tin', 4, 22.00, 15.0000, 5, 6, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(101, 'ING-001', 'Arabica Coffee Beans', 6, 0.00, 0.0650, 4000, 1500, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(102, 'ING-002', 'Butter', 6, 0.00, 0.0450, 3000, 1000, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(103, 'ING-003', 'Plain Flour', 6, 0.00, 0.0040, 10000, 3000, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(104, 'ING-004', 'Caster Sugar', 6, 0.00, 0.0035, 5000, 1500, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(105, 'ING-005', 'Eggs', 6, 0.00, 0.5500, 60, 24, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(106, 'ING-006', 'Blueberries', 6, 0.00, 0.0600, 1500, 500, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(107, 'ING-007', 'Chicken Breast', 6, 0.00, 0.0250, 4000, 1500, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(108, 'ING-008', 'Quinoa', 6, 0.00, 0.0120, 3000, 1000, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(109, 'ING-009', 'Mixed Greens', 6, 0.00, 0.0300, 1200, 500, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(110, 'ING-010', 'Focaccia Loaf', 6, 0.00, 2.2000, 20, 8, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(111, 'ING-011', 'Cheddar Cheese', 6, 0.00, 0.0600, 1500, 500, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(112, 'ING-012', 'Glass Bottle & Cap', 6, 0.00, 0.8000, 80, 30, 'https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85', 1, '2026-06-10 01:00:00', '2026-06-10 01:00:00');

INSERT INTO `recipes` (`id`, `product_id`, `ingredient_id`, `quantity_required`, `unit`, `notes`, `created_at`, `updated_at`) VALUES
(1, 7, 101, 30.000, 'g', 'Coarse grind, 18 h steep', '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(2, 7, 112, 1.000, 'piece', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(3, 2, 103, 60.000, 'g', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(4, 2, 102, 30.000, 'g', 'Laminated', '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(5, 2, 104, 8.000, 'g', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(6, 2, 105, 0.200, 'piece', 'Egg wash', '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(7, 5, 103, 50.000, 'g', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(8, 5, 102, 20.000, 'g', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(9, 5, 104, 25.000, 'g', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(10, 5, 105, 0.500, 'piece', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(11, 5, 106, 25.000, 'g', 'Per slice', '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(12, 3, 107, 120.000, 'g', 'Grilled', '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(13, 3, 108, 80.000, 'g', 'Cooked weight', '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(14, 3, 109, 40.000, 'g', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(15, 6, 110, 1.000, 'piece', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(16, 6, 111, 25.000, 'g', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(17, 6, 109, 20.000, 'g', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00'),
(18, 6, 107, 40.000, 'g', NULL, '2026-06-10 01:00:00', '2026-06-10 01:00:00');

INSERT INTO `transactions` (`id`, `user_id`, `transaction_number`, `transaction_type`, `status`, `subtotal`, `service_charge`, `tax`, `discount`, `rounding_adjustment`, `total`, `payment_method`, `created_at`) VALUES
(1, 1, 'PO-0036', 'PURCHASE', 'POSTED', 687.00, 0.00, 0.00, 0.00, 0.00, 687.00, NULL, '2026-06-15 01:05:00'),
(2, 1, 'PO-0037', 'PURCHASE', 'POSTED', 487.00, 0.00, 0.00, 0.00, 0.00, 487.00, NULL, '2026-06-16 01:15:00'),
(3, 2, 'SL-1044', 'SALE', 'CANCELLED', 12.50, 1.25, 0.75, 0.00, 0.00, 14.50, 'Cash', '2026-06-17 06:12:00'),
(4, 1, 'PO-0039', 'PURCHASE', 'DRAFT', 132.00, 0.00, 0.00, 0.00, 0.00, 132.00, NULL, '2026-06-17 07:20:00'),
(5, 3, 'SL-1045', 'SALE', 'POSTED', 48.00, 4.80, 2.88, 0.00, 0.02, 55.70, 'QR', '2026-06-17 08:55:00'),
(6, 1, 'PO-0038', 'PURCHASE', 'POSTED', 168.00, 0.00, 0.00, 0.00, 0.00, 168.00, NULL, '2026-06-18 00:42:00'),
(7, 2, 'SL-1046', 'SALE', 'POSTED', 22.50, 2.25, 1.35, 0.00, 0.00, 26.10, 'Card', '2026-06-18 02:08:00'),
(8, 2, 'SL-1047', 'SALE', 'POSTED', 42.00, 4.20, 2.52, 0.00, -0.02, 48.70, 'Cash', '2026-06-18 02:31:00');

INSERT INTO `transaction_items` (`id`, `transaction_id`, `product_id`, `quantity`, `unit_price`, `line_total`) VALUES
(1, 1, 101, 5000, 0.0650, 325.00),
(2, 1, 102, 3000, 0.0450, 135.00),
(3, 1, 103, 10000, 0.0040, 40.00),
(4, 1, 104, 5000, 0.0035, 17.50),
(5, 1, 105, 90, 0.5500, 49.50),
(6, 1, 106, 2000, 0.0600, 120.00),
(7, 2, 107, 5000, 0.0250, 125.00),
(8, 2, 108, 3000, 0.0120, 36.00),
(9, 2, 109, 2000, 0.0300, 60.00),
(10, 2, 110, 30, 2.2000, 66.00),
(11, 2, 111, 2000, 0.0600, 120.00),
(12, 2, 112, 100, 0.8000, 80.00),
(13, 3, 5, 1, 6.5000, 6.50),
(14, 3, 7, 1, 6.0000, 6.00),
(15, 4, 1, 12, 11.0000, 132.00),
(16, 5, 6, 2, 12.0000, 24.00),
(17, 5, 4, 1, 11.0000, 11.00),
(18, 5, 5, 2, 6.5000, 13.00),
(19, 6, 2, 20, 2.4000, 48.00),
(20, 6, 8, 8, 15.0000, 120.00),
(21, 7, 2, 2, 4.5000, 9.00),
(22, 7, 3, 1, 13.5000, 13.50),
(23, 8, 1, 2, 18.0000, 36.00),
(24, 8, 7, 1, 6.0000, 6.00);

INSERT INTO `stock_movements` (`id`, `product_id`, `movement_type`, `quantity_change`, `reference`, `performed_by`, `created_at`) VALUES
(2077, 5, 'ADJUSTMENT', -1, 'Damaged unit', 1, '2026-06-17 09:10:00'),
(2078, 8, 'PURCHASE', 8, 'PO-0038', 1, '2026-06-18 00:42:00'),
(2079, 2, 'PURCHASE', 20, 'PO-0038', 1, '2026-06-18 00:42:00'),
(2080, 7, 'SALE', -1, 'SL-1047', 2, '2026-06-18 02:31:00'),
(2081, 1, 'SALE', -2, 'SL-1047', 2, '2026-06-18 02:31:00');

-- 7-day demand forecast shown on the Forecasts screen (demo values from the prototype)
INSERT INTO `forecast_results` (`product_id`, `category_id`, `forecast_date`, `horizon_days`, `predicted_quantity`, `model_name`, `model_version`, `generated_at`) VALUES
(1, 1, '2026-06-19', 7, 31.40, 'prototype-demo', '0.1', '2026-06-18 16:00:00'),
(2, 2, '2026-06-19', 7, 23.20, 'prototype-demo', '0.1', '2026-06-18 16:00:00'),
(3, 3, '2026-06-19', 7, 10.80, 'prototype-demo', '0.1', '2026-06-18 16:00:00'),
(5, 2, '2026-06-19', 7, 13.60, 'prototype-demo', '0.1', '2026-06-18 16:00:00'),
(7, 5, '2026-06-19', 7, 27.10, 'prototype-demo', '0.1', '2026-06-18 16:00:00');

-- Continue auto-increment after the seeded ids
ALTER TABLE `categories` AUTO_INCREMENT = 7;
ALTER TABLE `roles` AUTO_INCREMENT = 3;
ALTER TABLE `users` AUTO_INCREMENT = 7;
ALTER TABLE `products` AUTO_INCREMENT = 113;
ALTER TABLE `recipes` AUTO_INCREMENT = 19;
ALTER TABLE `transactions` AUTO_INCREMENT = 9;
ALTER TABLE `transaction_items` AUTO_INCREMENT = 25;
ALTER TABLE `stock_movements` AUTO_INCREMENT = 2082;

COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
