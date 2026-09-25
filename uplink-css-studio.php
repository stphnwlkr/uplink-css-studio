<?php
/**
 * Plugin Name: Uplink CSS Studio for Bricks
 * Plugin URI: https://uplinkplugins.com/articles/meet-uplink-css-studio-for-bricks/
 * Description: A code-first CSS workspace for Bricks with live sync, completion, visual value tools, recipes, and query helpers.
 * Version: 1.1.2
 * Requires at least: 7.0
 * Requires PHP: 8.3
 * Tested up to: 7.1
 * Author: Stephen Walker
 * Author URI: https://uplinkplugins.com/
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: uplink-css-studio-for-bricks
 */

namespace Uplink\CssStudio;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Plugin {
	const VERSION = '1.1.2';
	const MINIMUM_BRICKS_VERSION = '2.4';
	const USER_RECIPES_META = '_uplink_css_studio_recipes';

	private static function is_bricks_compatible() {
		return defined( 'BRICKS_VERSION' ) && version_compare( BRICKS_VERSION, self::MINIMUM_BRICKS_VERSION, '>=' );
	}

	private static function is_css_sync_enabled() {
		return self::is_bricks_compatible()
			&& class_exists( '\\Bricks\\Database' )
			&& (bool) \Bricks\Database::get_setting( 'builderCssSync', false );
	}

	private static function get_user_recipes() {
		$recipes = get_user_meta( get_current_user_id(), self::USER_RECIPES_META, true );
		return is_array( $recipes ) ? $recipes : array();
	}

	private static function get_css_recipes() {
		if ( ! class_exists( '\\Automatic_CSS\\API' ) || ! is_callable( array( '\\Automatic_CSS\\API', 'get_all_recipes' ) ) ) {
			return array();
		}

		try {
			$available = \Automatic_CSS\API::get_all_recipes();
		} catch ( \Throwable $error ) {
			return array();
		}

		$recipes = array();
		foreach ( is_array( $available ) ? $available : array() as $name => $css ) {
			if ( ! is_string( $name ) || ! is_string( $css ) || '' === trim( $css ) ) {
				continue;
			}
			if ( preg_match( '/<script|document\.|=>|^\s*return\s*\[/mi', $css ) ) {
				continue;
			}
			if ( ! preg_match( '/%root%|@(?:media|container|supports|layer|property|scope)\b|(?:^|\n)\s*[-\w]+\s*:|\b(?:var|hsl|rgb|oklch|color-mix)\(/m', $css ) ) {
				continue;
			}
			$recipes[ sanitize_key( $name ) ] = $css;
		}

		return $recipes;
	}

	private static function normalize_variable_names( $variables ) {
		$names = array();
		foreach ( is_array( $variables ) ? $variables : array() as $variable ) {
			$name = is_array( $variable ) && isset( $variable['name'] ) ? $variable['name'] : $variable;
			if ( ! is_string( $name ) ) {
				continue;
			}
			$name = ltrim( trim( $name ), '-' );
			if ( '' !== $name && preg_match( '/^[A-Za-z_][A-Za-z0-9_-]*$/', $name ) ) {
				$names[] = '--' . $name;
			}
		}

		return array_values( array_unique( $names ) );
	}

	private static function get_design_variables() {
		$automatic_css = array();
		if ( class_exists( '\\Automatic_CSS\\Model\\Config\\Framework' ) ) {
			try {
				$automatic_css = ( new \Automatic_CSS\Model\Config\Framework() )->get_variables( true );
			} catch ( \Throwable $error ) {
				$automatic_css = array();
			}
		}

		return array(
			'bricks'       => self::normalize_variable_names( get_option( 'bricks_global_variables', array() ) ),
			'automaticCss' => self::normalize_variable_names( $automatic_css ),
		);
	}

	private static function clean_css_color( $value ) {
		$value = is_string( $value ) ? trim( wp_strip_all_tags( $value ) ) : '';
		return '' === $value || preg_match( '/[;{}<>]/', $value ) ? '' : $value;
	}

	private static function get_color_palette() {
		$option_name = defined( 'BRICKS_DB_COLOR_PALETTE' ) ? BRICKS_DB_COLOR_PALETTE : 'bricks_color_palette';
		$palettes    = get_option( $option_name, array() );
		if ( empty( $palettes ) && class_exists( '\\Bricks\\Database' ) && is_callable( array( '\\Bricks\\Database', 'default_color_palette' ) ) ) {
			$palettes = \Bricks\Database::default_color_palette();
		}

		$output = array();
		foreach ( is_array( $palettes ) ? $palettes : array() as $palette ) {
			$palette_name = isset( $palette['name'] ) ? sanitize_text_field( $palette['name'] ) : __( 'Bricks palette', 'uplink-css-studio-for-bricks' );
			$colors       = array();
			foreach ( isset( $palette['colors'] ) && is_array( $palette['colors'] ) ? $palette['colors'] : array() as $color ) {
				if ( ! is_array( $color ) ) {
					continue;
				}
				$raw     = self::clean_css_color( $color['raw'] ?? '' );
				$light   = self::clean_css_color( $color['light'] ?? ( $color['hex'] ?? ( $color['rgb'] ?? '' ) ) );
				if ( $raw && 0 === strpos( ltrim( $raw ), 'var(' ) && ! preg_match( '/^var\(\s*--[A-Za-z_][A-Za-z0-9_-]*(?:\s*,\s*[^;{}<>]+)?\s*\)$/', $raw ) ) {
					$raw = '';
				}
				$value   = $raw ? $raw : $light;
				$preview = $light ? $light : $value;
				if ( ! $value ) {
					continue;
				}
				$name = isset( $color['name'] ) ? sanitize_text_field( $color['name'] ) : '';
				if ( ! $name && preg_match( '/var\(\s*(--[^,)\s]+)/', $raw, $match ) ) {
					$name = $match[1];
				}
				$colors[] = array(
					'name'    => $name ? $name : $value,
					'value'   => $value,
					'preview' => $preview,
				);
			}
			if ( $colors ) {
				$output[] = array( 'name' => $palette_name, 'colors' => $colors );
			}
		}

		return $output;
	}

	public static function boot() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_builder_assets' ), 100 );
		add_action( 'wp_ajax_uplink_css_studio_save_recipes', array( __CLASS__, 'save_user_recipes' ) );
		add_action( 'admin_notices', array( __CLASS__, 'render_prerequisite_notice' ) );
	}

	public static function render_prerequisite_notice() {
		if ( ! current_user_can( 'manage_options' ) || self::is_css_sync_enabled() ) {
			return;
		}

		if ( ! self::is_bricks_compatible() ) {
			$message = sprintf(
				/* translators: %s: minimum supported Bricks version. */
				esc_html__( 'Uplink CSS Studio requires Bricks %s or newer. Activate or update Bricks before using CSS Studio.', 'uplink-css-studio-for-bricks' ),
				esc_html( self::MINIMUM_BRICKS_VERSION )
			);
		} else {
			$settings_url = admin_url( 'admin.php?page=bricks-settings#tab-builder' );
			$message      = sprintf(
				/* translators: %s: link to the Bricks Builder settings. */
				wp_kses_post( __( 'Uplink CSS Studio requires Bricks CSS Sync. Enable <strong>Bi-directional sync between Custom CSS and style controls</strong> under <a href="%s">Bricks &gt; Settings &gt; Builder</a>.', 'uplink-css-studio-for-bricks' ) ),
				esc_url( $settings_url )
			);
		}

		printf( '<div class="notice notice-warning"><p>%s</p></div>', wp_kses_post( $message ) );
	}

	public static function save_user_recipes() {
		check_ajax_referer( 'uplink_css_studio_recipes', 'nonce' );

		$post_id = isset( $_POST['postId'] ) ? absint( $_POST['postId'] ) : 0;
		if ( ! $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
			wp_send_json_error( array( 'message' => __( 'You do not have permission to save CSS recipes.', 'uplink-css-studio-for-bricks' ) ), 403 );
		}

		$raw = isset( $_POST['recipes'] ) && is_string( $_POST['recipes'] ) ? wp_unslash( $_POST['recipes'] ) : '{}'; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized
		if ( strlen( $raw ) > 500000 ) {
			wp_send_json_error( array( 'message' => __( 'The recipe collection is too large.', 'uplink-css-studio-for-bricks' ) ), 413 );
		}
		$decoded = json_decode( $raw, true );
		if ( ! is_array( $decoded ) || count( $decoded ) > 100 ) {
			wp_send_json_error( array( 'message' => __( 'The recipe collection is invalid.', 'uplink-css-studio-for-bricks' ) ), 400 );
		}

		$recipes = array();
		foreach ( $decoded as $name => $value ) {
			$key = sanitize_key( $name );
			$css = is_string( $value ) ? $value : ( is_array( $value ) && isset( $value['css'] ) && is_string( $value['css'] ) ? $value['css'] : '' );
			$css = str_replace( array( "\r\n", "\r", "\0" ), array( "\n", "\n", '' ), $css );
			$label = is_array( $value ) && isset( $value['label'] ) && is_string( $value['label'] ) ? sanitize_text_field( $value['label'] ) : ucwords( str_replace( array( '-', '_' ), ' ', $key ) );
			$label = '' !== trim( $label ) ? substr( trim( $label ), 0, 120 ) : ucwords( str_replace( array( '-', '_' ), ' ', $key ) );
			$category = is_array( $value ) && isset( $value['category'] ) && is_string( $value['category'] ) ? sanitize_text_field( $value['category'] ) : __( 'My recipes', 'uplink-css-studio-for-bricks' );
			$category = '' !== trim( $category ) ? substr( trim( $category ), 0, 80 ) : __( 'My recipes', 'uplink-css-studio-for-bricks' );
			if ( '' === $key || '' === trim( $css ) || strlen( $css ) > 50000 ) {
				continue;
			}
			$recipes[ $key ] = array(
				'label'    => $label,
				'css'      => $css,
				'category' => $category,
			);
		}

		update_user_meta( get_current_user_id(), self::USER_RECIPES_META, $recipes );
		wp_send_json_success( array( 'recipes' => $recipes ) );
	}

	public static function enqueue_builder_assets() {
		if ( ! self::is_css_sync_enabled() || ! function_exists( 'bricks_is_builder_main' ) || ! bricks_is_builder_main() ) {
			return;
		}

		$post_id = isset( $_GET['post_id'] ) ? absint( $_GET['post_id'] ) : get_queried_object_id(); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		if ( ! $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		if ( ! function_exists( 'wp_enqueue_code_editor' ) ) {
			require_once ABSPATH . 'wp-admin/includes/misc.php';
		}

		$editor_settings = wp_enqueue_code_editor(
			array(
				'type'       => 'text/css',
				'codemirror' => array(
					'indentUnit'       => 2,
					'tabSize'          => 2,
					'indentWithTabs'   => false,
					'lineNumbers'      => true,
					'lineWrapping'     => false,
					'autoCloseBrackets'=> true,
					'matchBrackets'    => true,
					'styleActiveLine'  => true,
				),
			)
		);
		$html_editor_settings = wp_enqueue_code_editor(
			array(
				'type'       => 'text/html',
				'codemirror' => array(
					'indentUnit'      => 2,
					'tabSize'         => 2,
					'indentWithTabs'  => false,
					'lineNumbers'     => true,
					'lineWrapping'    => true,
					'autoCloseTags'   => true,
					'matchTags'       => false,
					'styleActiveLine' => true,
				),
			)
		);

		/*
		 * Bricks 2.4 ships its own CodeMirror base and one-dark theme. WordPress'
		 * code editor styles are global and load later, which turns Bricks' native
		 * CSS editor white. Keep the scripts and settings, but leave all native
		 * CodeMirror presentation to Bricks.
		 */
		wp_dequeue_style( 'code-editor' );
		wp_dequeue_style( 'wp-codemirror' );

		$base_url = plugin_dir_url( __FILE__ );
		$recipes  = self::get_css_recipes();
		wp_enqueue_style( 'uplink-css-studio', $base_url . 'assets/css/studio.css', array( 'bricks-builder' ), self::asset_version( 'assets/css/studio.css' ) );
		wp_enqueue_script( 'uplink-css-catalog', $base_url . 'assets/js/css-catalog.js', array(), self::asset_version( 'assets/js/css-catalog.js' ), true );
		wp_enqueue_script( 'uplink-css-studio', $base_url . 'assets/js/studio.js', array( 'jquery', 'wp-codemirror', 'code-editor', 'bricks-builder', 'uplink-css-catalog' ), self::asset_version( 'assets/js/studio.js' ), true );
		wp_localize_script(
			'uplink-css-studio',
			'UplinkCssStudioConfig',
			array(
				'editorSettings'     => $editor_settings,
				'htmlEditorSettings' => $html_editor_settings,
				'postId'         => $post_id,
				'version'        => self::VERSION,
				'recipeProvider' => empty( $recipes ) ? '' : 'ACSS',
				'recipes'        => $recipes,
				'userRecipes'    => self::get_user_recipes(),
				'designVariables' => self::get_design_variables(),
				'colorPalette'    => self::get_color_palette(),
				'ajaxUrl'        => admin_url( 'admin-ajax.php' ),
				'recipeNonce'    => wp_create_nonce( 'uplink_css_studio_recipes' ),
				'labels'         => array(
					'title'       => __( 'CSS Studio', 'uplink-css-studio-for-bricks' ),
					'noSelection' => __( 'Select an element in Bricks to edit its CSS.', 'uplink-css-studio-for-bricks' ),
				),
			)
		);
	}

	private static function asset_version( $relative_path ) {
		$file = plugin_dir_path( __FILE__ ) . ltrim( $relative_path, '/' );
		return is_file( $file ) ? (string) filemtime( $file ) : self::VERSION;
	}
}

Plugin::boot();
