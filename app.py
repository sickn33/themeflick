from flask import Flask, render_template, request, jsonify
from models.movie import Movie, db
import numpy as np
import requests
import os
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from collections import defaultdict
from datetime import datetime

load_dotenv()

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///movies.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['FREEZER_RELATIVE_URLS'] = True

TMDB_API_KEY = os.getenv('VITE_TMDB_API_KEY')
TMDB_ACCESS_TOKEN = os.getenv('VITE_TMDB_ACCESS_TOKEN')
TMDB_BASE_URL = "https://api.themoviedb.org/3"

db.init_app(app)

def fetch_tmdb_data(url, headers, params=None):
    try:
        # Fallback: se non abbiamo Bearer token, usiamo api_key (se disponibile)
        if params is None:
            params = {}
        if not headers.get('Authorization') and TMDB_API_KEY:
            params = dict(params)
            params.setdefault('api_key', TMDB_API_KEY)

        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        print(f"Error fetching data from {url}: {str(e)}")
        return None

def get_movie_details(movie_id, headers):
    details_url = f"{TMDB_BASE_URL}/movie/{movie_id}"
    params = {
        "append_to_response": "credits,keywords,reviews,recommendations,similar"
    }
    return fetch_tmdb_data(details_url, headers, params)

def get_movies_by_collection(collection_id, headers):
    collection_url = f"{TMDB_BASE_URL}/collection/{collection_id}"
    return fetch_tmdb_data(collection_url, headers)

def get_director_movies(director_id, headers):
    person_url = f"{TMDB_BASE_URL}/person/{director_id}/movie_credits"
    return fetch_tmdb_data(person_url, headers)

def discover_movies_by_keywords(keyword_ids, headers, limit=10):
    """Discover popular movies that share important keywords (e.g., 'musical', 'heist')"""
    if not keyword_ids:
        return []
    
    # Use top 3 most important keywords
    keyword_str = '|'.join(str(k) for k in keyword_ids[:3])
    discover_url = f"{TMDB_BASE_URL}/discover/movie"
    params = {
        "with_keywords": keyword_str,
        "sort_by": "vote_count.desc",  # Popular movies first
        "vote_count.gte": 500,  # Only well-known movies
        "page": 1
    }
    result = fetch_tmdb_data(discover_url, headers, params)
    if result and 'results' in result:
        return result['results'][:limit]
    return []

def calculate_similarity(movie1, movie2, weights):
    """
    Clean similarity algorithm v2.0
    Philosophy: Genre defines pool, features define rank
    No source bonuses - pure similarity only
    """
    import math
    score = 0
    
    # 1. GENRE SIMILARITY (30%) - with defining genre boost
    # Defining genres that really characterize a film's identity
    defining_genres = {
        16,     # Animation
        10402,  # Music/Musical
        37,     # Western
        27,     # Horror
        878,    # Sci-Fi
        14,     # Fantasy
        10749,  # Romance
    }
    
    g1 = {g['id'] for g in movie1.get('genres', [])}
    g2 = {g['id'] for g in movie2.get('genres', [])}
    
    if g1 and g2:
        shared = g1 & g2
        union = g1 | g2
        
        # Base Jaccard similarity
        base_genre_score = len(shared) / len(union) if union else 0
        
        # Defining genre bonus: if both share a defining genre, boost significantly
        shared_defining = shared & defining_genres
        if shared_defining:
            base_genre_score = min(1.0, base_genre_score + 0.3)
        
        score += weights['genre'] * base_genre_score * 100
    
    # 2. DIRECTOR MATCH (15%)
    dir1 = next((c['id'] for c in movie1.get('credits', {}).get('crew', []) 
                 if c['job'] == 'Director'), None)
    dir2 = next((c['id'] for c in movie2.get('credits', {}).get('crew', []) 
                 if c['job'] == 'Director'), None)
    if dir1 and dir2 and dir1 == dir2:
        score += weights['director'] * 100
    
    # 3. CAST OVERLAP (15%) - top 5 billed actors
    cast1 = {c['id'] for c in movie1.get('credits', {}).get('cast', [])[:5]}
    cast2 = {c['id'] for c in movie2.get('credits', {}).get('cast', [])[:5]}
    if cast1 and cast2:
        cast_overlap = len(cast1 & cast2) / 5  # Max 5 actors
        score += weights['cast'] * cast_overlap * 100
    
    # 4. KEYWORDS (15%) - with STRONG defining keyword matching
    # Defining keywords that MUST match for thematic similarity
    defining_keywords = {
        4344,   # musical - CRITICAL for musicals
        9715,   # superhero
        3799,   # heist
        10714,  # serial killer
        9882,   # space
        207317, # christmas
        276,    # sport
        155,    # spy
        12990,  # singing - important for musicals
    }
    
    kw1 = {k['id'] for k in movie1.get('keywords', {}).get('keywords', [])}
    kw2 = {k['id'] for k in movie2.get('keywords', {}).get('keywords', [])}
    
    defining_penalty = 0
    if kw1 and kw2:
        shared_kw = kw1 & kw2
        shared_count = len(shared_kw)
        
        # Base keyword score: 3 shared keywords = 100%
        keyword_score = min(1.0, shared_count / 3)
        
        # Check for defining keywords
        base_defining = kw1 & defining_keywords
        candidate_defining = kw2 & defining_keywords
        shared_defining = shared_kw & defining_keywords
        
        if shared_defining:
            # BONUS: Both share a defining keyword (e.g., both are musicals)
            score += 25  # Direct +25 points bonus
        elif base_defining and not candidate_defining:
            # PENALTY: Base has defining keyword but candidate doesn't
            # E.g., Greatest Showman (musical) vs American Beauty (no musical keyword)
            defining_penalty = -25
        
        score += weights['keywords'] * keyword_score * 100
    
    score += defining_penalty  # Apply penalty after keyword scoring
    
    # 5. RATING SIMILARITY (10%) - within 2 points = good match
    r1 = movie1.get('vote_average', 0)
    r2 = movie2.get('vote_average', 0)
    if r1 and r2:
        rating_diff = abs(r1 - r2)
        rating_score = max(0, 1 - rating_diff / 4)  # 4 point diff = 0
        score += weights['rating'] * rating_score * 100
    
    # 6. ERA SIMILARITY (10%) - same decade preferred
    y1 = int(movie1['release_date'][:4]) if movie1.get('release_date') else None
    y2 = int(movie2['release_date'][:4]) if movie2.get('release_date') else None
    if y1 and y2:
        decade1 = y1 // 10
        decade2 = y2 // 10
        if decade1 == decade2:
            era_score = 1.0
        elif abs(decade1 - decade2) == 1:
            era_score = 0.6
        else:
            era_score = 0.3
        score += weights['era'] * era_score * 100
    
    # 7. POPULARITY TIER (5%) - similar popularity level
    pop1 = movie1.get('popularity', 0)
    pop2 = movie2.get('popularity', 0)
    if pop1 and pop2:
        # Use log scale for popularity comparison
        log_pop1 = math.log10(max(1, pop1))
        log_pop2 = math.log10(max(1, pop2))
        pop_diff = abs(log_pop1 - log_pop2)
        pop_score = max(0, 1 - pop_diff / 2)
        score += weights['popularity'] * pop_score * 100
    
    return min(100, max(0, score))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/api/search', methods=['POST'])
def search_movies():
    try:
        movie_title = request.json.get('title')
        if not movie_title:
            return jsonify({'error': 'Movie title is required'}), 400

        if not TMDB_ACCESS_TOKEN and not TMDB_API_KEY:
            return jsonify({
                'error': 'TMDB non configurato: imposta VITE_TMDB_ACCESS_TOKEN o VITE_TMDB_API_KEY'
            }), 500

        headers = {
            "accept": "application/json"
        }
        if TMDB_ACCESS_TOKEN:
            headers["Authorization"] = f"Bearer {TMDB_ACCESS_TOKEN}"

        # 1. Search for the base movie
        search_url = f"{TMDB_BASE_URL}/search/movie"
        search_results = fetch_tmdb_data(search_url, headers, {
            "query": movie_title,
            "include_adult": False,
            "language": "en-US",
            "page": 1
        })

        if search_results is None:
            return jsonify({
                'error': 'Errore nel contatto con TMDB. Verifica le credenziali (token/api key).'
            }), 502

        if not search_results.get('results'):
            return jsonify({'error': 'Movie not found'}), 404

        base_movie = search_results['results'][0]
        base_movie_id = base_movie['id']

        # 2. Get detailed information about the base movie
        base_movie_details = get_movie_details(base_movie_id, headers)
        if not base_movie_details:
            return jsonify({
                'error': 'Errore nel recupero dettagli da TMDB. Verifica le credenziali (token/api key).'
            }), 502

        # 3. Collect candidate movies from multiple sources
        candidate_movies = defaultdict(lambda: {'movie': None, 'sources': set()})

        # 3.1 Add movies from the same collection (franchise)
        if base_movie_details.get('belongs_to_collection'):
            collection_data = get_movies_by_collection(
                base_movie_details['belongs_to_collection']['id'], 
                headers
            )
            if collection_data and 'parts' in collection_data:
                for movie in collection_data['parts']:
                    candidate_movies[movie['id']]['movie'] = movie
                    candidate_movies[movie['id']]['sources'].add('collection')

        # 3.2 Add movies from the same director (limited to top 5 by rating)
        director = next((crew for crew in base_movie_details.get('credits', {}).get('crew', [])
                       if crew['job'] == 'Director'), None)
        if director:
            director_movies = get_director_movies(director['id'], headers)
            if director_movies and 'crew' in director_movies:
                # Filter only directing credits and sort by vote_average
                directed_movies = [
                    movie for movie in director_movies['crew']
                    if movie['job'] == 'Director' and movie.get('vote_average') is not None
                ]
                directed_movies.sort(key=lambda x: x.get('vote_average', 0), reverse=True)
                
                # Take only top 2 rated movies from director (reduced to avoid dominating results)
                for movie in directed_movies[:2]:
                    candidate_movies[movie['id']]['movie'] = movie
                    candidate_movies[movie['id']]['sources'].add('director')

        # 3.3 Add similar movies (increased number)
        if 'similar' in base_movie_details and 'results' in base_movie_details['similar']:
            for movie in base_movie_details['similar']['results'][:15]:  # Increased from default
                candidate_movies[movie['id']]['movie'] = movie
                candidate_movies[movie['id']]['sources'].add('similar')

        # 3.4 Add recommended movies (increased number)
        if 'recommendations' in base_movie_details and 'results' in base_movie_details['recommendations']:
            for movie in base_movie_details['recommendations']['results'][:15]:  # Increased from default
                candidate_movies[movie['id']]['movie'] = movie
                candidate_movies[movie['id']]['sources'].add('recommendations')

        # 3.5 Add movies by shared keywords (e.g., finds other musicals, heist films)
        # This catches thematic matches that TMDB similar/recommendations miss
        base_keywords = base_movie_details.get('keywords', {}).get('keywords', [])
        important_keyword_ids = [k['id'] for k in base_keywords[:5]]  # Top 5 keywords
        keyword_movies = discover_movies_by_keywords(important_keyword_ids, headers, limit=15)
        for movie in keyword_movies:
            if movie['id'] != base_movie_id:
                candidate_movies[movie['id']]['movie'] = movie
                candidate_movies[movie['id']]['sources'].add('keyword_discovery')

        # 4. Get detailed information for all candidate movies
        with ThreadPoolExecutor(max_workers=10) as executor:
            future_to_movie = {
                executor.submit(get_movie_details, movie_id, headers): (movie_id, data)
                for movie_id, data in candidate_movies.items()
                if movie_id != base_movie_id
            }

            detailed_candidates = []
            for future in future_to_movie:
                movie_id, data = future_to_movie[future]
                try:
                    movie_details = future.result()
                    if movie_details:
                        detailed_candidates.append({
                            'details': movie_details,
                            'sources': data['sources']
                        })
                except Exception as e:
                    print(f"Error processing movie {movie_id}: {str(e)}")

        # 5. Calculate similarity scores and process results
        processed_movies = []
        base_genres = {genre['id'] for genre in base_movie_details.get('genres', [])}
        base_keywords = {kw['id'] for kw in base_movie_details.get('keywords', {}).get('keywords', [])}
        base_cast = {cast['id'] for cast in base_movie_details.get('credits', {}).get('cast', [])[:5]}
        base_director = next((crew['id'] for crew in base_movie_details.get('credits', {}).get('crew', [])
                            if crew['job'] == 'Director'), None)
        base_year = int(base_movie_details['release_date'][:4]) if base_movie_details.get('release_date') else None

        # Get current date for release date comparison
        from datetime import datetime
        current_date = datetime.now().strftime('%Y-%m-%d')

        # New clean weights - genre defines pool, features define rank
        weights = {
            'genre': 0.30,      # Core identity of film (with defining genre boost)
            'director': 0.15,   # Style/tone indicator
            'cast': 0.15,       # Star presence matters
            'keywords': 0.15,   # Thematic elements (reduced - TMDB keywords unreliable)
            'rating': 0.10,     # Quality tier
            'era': 0.10,        # Period context
            'popularity': 0.05  # Blockbuster vs indie
        }
        # Source bonuses removed - let pure similarity determine ranking

        for candidate in detailed_candidates:
            movie = candidate['details']
            sources = candidate['sources']
            
            # Skip movies that haven't been released yet
            if movie.get('release_date') and movie['release_date'] > current_date:
                continue

            # Genre filter: require at least 1 genre overlap
            # Exception: collection/franchise movies are always included
            if 'collection' not in sources:
                movie_genres = set(g['id'] for g in movie.get('genres', []))
                base_genres = set(g['id'] for g in base_movie_details.get('genres', []))
                if not (movie_genres & base_genres):  # No genre overlap
                    continue  # Skip this movie - not thematically related

            score = calculate_similarity(base_movie_details, movie, weights)

            if score >= 30:  # Balanced threshold for quality
                processed_movies.append({
                    'id': movie['id'],
                    'title': movie['title'],
                    'year': int(movie['release_date'][:4]) if movie.get('release_date') else None,
                    'similarity_score': score,
                    'genre': [genre['name'] for genre in movie.get('genres', [])],
                    'director': next((crew['name'] for crew in movie.get('credits', {}).get('crew', [])
                                   if crew['job'] == 'Director'), 'Unknown'),
                    'rating': round(movie['vote_average'], 1),
                    'reviews': process_reviews(movie.get('reviews', {}).get('results', [])),
                    'poster_path': movie['poster_path'],
                    'overview': movie['overview']
                })

        # Sort by similarity score
        processed_movies.sort(key=lambda x: x['similarity_score'], reverse=True)
        return jsonify(processed_movies[:20])  # Return top 20 movies

    except Exception as e:
        print(f"Error: {str(e)}")
        return jsonify({'error': str(e)}), 500

def process_reviews(reviews):
    processed = []
    for review in reviews[:3]:
        processed.append({
            'text': review.get('content', '')[:200] + '...',
            'rating': review.get('author_details', {}).get('rating', 0)
        })
    return processed

@app.route('/favorites')
def favorites():
    return render_template('favorites.html')

@app.context_processor
def inject_year():
    # Cache busting per asset statici (evita che il browser usi JS/CSS vecchi)
    try:
        main_js_path = os.path.join(app.root_path, 'static', 'js', 'main.js')
        static_version = int(os.path.getmtime(main_js_path))
    except Exception:
        static_version = int(datetime.now().timestamp())

    return {
        'year': datetime.now().year,
        'static_version': static_version
    }

@app.route('/movie/<int:movie_id>')
def movie_details(movie_id):
    try:
        if not TMDB_ACCESS_TOKEN and not TMDB_API_KEY:
            return render_template(
                'error.html',
                message='TMDB non configurato: imposta VITE_TMDB_ACCESS_TOKEN o VITE_TMDB_API_KEY'
            ), 500

        headers = {
            "accept": "application/json"
        }
        if TMDB_ACCESS_TOKEN:
            headers["Authorization"] = f"Bearer {TMDB_ACCESS_TOKEN}"
        
        # Get detailed movie information
        movie_details = get_movie_details(movie_id, headers)
        if not movie_details:
            return render_template(
                'error.html',
                message='Impossibile recuperare i dettagli del film da TMDB.'
            ), 502

        # Process cast (limit to top 10)
        cast = movie_details.get('credits', {}).get('cast', [])[:10]
        
        # Process crew (get director and key roles)
        crew = movie_details.get('credits', {}).get('crew', [])
        director = next((member for member in crew if member['job'] == 'Director'), None)
        key_crew = [member for member in crew if member['job'] in ['Director', 'Writer', 'Producer', 'Cinematographer']][:5]
        
        # Process reviews
        reviews = movie_details.get('reviews', {}).get('results', [])
        processed_reviews = []
        for review in reviews:
            processed_reviews.append({
                'author': review.get('author', 'Anonymous'),
                'content': review.get('content', ''),
                'rating': review.get('author_details', {}).get('rating'),
                'created_at': review.get('created_at', '').split('T')[0]
            })

        # Get collection info if movie is part of a collection
        collection = None
        if movie_details.get('belongs_to_collection'):
            collection_data = get_movies_by_collection(
                movie_details['belongs_to_collection']['id'],
                headers
            )
            if collection_data:
                collection = {
                    'name': collection_data.get('name'),
                    'movies': sorted(collection_data.get('parts', []), key=lambda x: x.get('release_date', ''))
                }

        return render_template('movie_details.html',
                             movie=movie_details,
                             cast=cast,
                             director=director,
                             key_crew=key_crew,
                             reviews=processed_reviews[:5],
                             collection=collection)
    except Exception as e:
        print(f"Error fetching movie details: {str(e)}")
        return render_template('error.html', message='Failed to load movie details'), 500

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True, port=5002)
