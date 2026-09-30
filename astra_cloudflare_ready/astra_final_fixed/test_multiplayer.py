import os


def test_world_state_model_exists():
    import app
    from models import WorldState

    assert hasattr(app, "load_world_state")
    assert WorldState.__tablename__ == "world_state"
