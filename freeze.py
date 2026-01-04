from flask_frozen import Freezer
from app import app, db
import os
import shutil
import sys

def setup_build_directory():
    """Setup the build directory and copy necessary files."""
    print("Setting up build directory...")
    if not os.path.exists('build'):
        os.makedirs('build')
        print("Created build directory")

    # Copy static files
    if os.path.exists('static'):
        shutil.copytree('static', 'build/static', dirs_exist_ok=True)
        print("Copied static files")

    # Copy database
    if os.path.exists('instance/movies.db'):
        os.makedirs('build/instance', exist_ok=True)
        shutil.copy2('instance/movies.db', 'build/instance/movies.db')
        print("Copied database")

def configure_app():
    """Configure the Flask app for freezing."""
    print("Configuring Flask app...")
    os.environ['GITHUB_PAGES'] = 'true'
    
    app.config['FREEZER_DESTINATION'] = 'build'
    app.config['FREEZER_BASE_URL'] = 'https://sck000.github.io/MovieBridge/'
    app.config['FREEZER_RELATIVE_URLS'] = True
    
    return Freezer(app)

def generate_urls(freezer):
    """Register URL generators for Frozen-Flask."""
    @freezer.register_generator
    def movie_details():
        # Get all movie IDs from the database
        with app.app_context():
            try:
                from models.movie import Movie
                movies = Movie.query.all()
                for movie in movies:
                    yield {'movie_id': movie.id}
            except Exception as e:
                print(f"Error generating movie URLs: {e}")
                return []

def main():
    try:
        setup_build_directory()
        freezer = configure_app()
        generate_urls(freezer)
        
        print("Starting to freeze app...")
        freezer.freeze()
        print("Successfully froze the app!")
        return 0
        
    except Exception as e:
        print(f"Error freezing app: {e}", file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
